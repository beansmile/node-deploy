/* eslint-disable no-console */
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { exec } = require('child-process-promise');
const { NodeSSH: OriginNodeSSH } = require('node-ssh');
const _ = require('lodash');
const { glob } = require('glob');
const tar = require('tar-stream');
const DeployToOss = require('./deploy-ali-oss');
const DeployToCos = require('./deploy-tencent-cos');

const defaultConfig = {
  username: 'deploy',
  port: '22',
  privateKeyPath: `${os.homedir()}/.ssh/id_rsa`,
};

class NodeSSH extends OriginNodeSSH {
  constructor(deployConfig = {}) {
    super();
    const {
      afterUpload,
      project_dir,
      namespace = 'current',
      release_name,
      local_target,
      tar = false,
      excludes = [],
      includes = [],
      versionsRetainedNumber = 1,
      globPattern = '**/*', // 新增：glob 匹配模式（传了就用 Node.js tar-stream）
      globIgnore = [], // 新增：glob 排除模式
    } = this.deployConfig = deployConfig;

    this.afterUpload = afterUpload;
    this.localTarget = local_target;
    this.tar = tar;
    this.includes = includes;
    this.excludes = excludes;
    this.globPattern = globPattern;
    this.globIgnore = globIgnore;
    this.versionsRetainedNumber = Math.max(versionsRetainedNumber, 1);
    this.projectDir = project_dir; // /var/www/xxx-frontend
    this.namespace = namespace; // app
    this.distTarget = path.posix.join(this.projectDir, this.namespace); // /var/www/xxx-frontend/app
    this.releasesDir = path.posix.join(this.projectDir, [this.namespace, 'releases'].join('-')); // /var/www/xxx-frontend/app-releases
    this.newReleaseDir = path.posix.join(this.releasesDir, release_name); // /var/www/xxx-frontend/app-releases/YYYY-MM-DD_HH_mm
  }

  forwardOut(...args) {
    return new Promise((resolve, reject) => {
      this.connection.forwardOut(...args, (err, stream) => {
        if (err) {
          reject(err);
          this.connection.end();
        } else {
          resolve(stream);
        }
      });
    });
  }

  async connect2(config, assignDefault = true) {
    if (assignDefault) { config = Object.assign({}, defaultConfig, config); }
    console.log('connect:', {
      host: config.host,
      post: config.port,
      forwardOut: config.forwardOut,
      isSock: Boolean(config.sock),
    });
    await this.connect(config);

    let { forwardOut } = config;
    if (forwardOut) {
      forwardOut = Object.assign({}, defaultConfig, forwardOut);
      console.log(`forwardOut('127.0.0.1', 22, ${forwardOut.host}, ${forwardOut.port})`);
      const stream = await this.forwardOut('127.0.0.1', 22, forwardOut.host, forwardOut.port);
      const ssh = new this.constructor(this.deployConfig);
      return ssh.connect2({
        sock: stream,
        ..._.omit(forwardOut, 'host', 'port'),
      }, false);
    } else {
      return this;
    }
  }

  // 使用 Node.js tar-stream 打包（支持 globPattern 和 globIgnore）
  // globIgnore 语法示例：
  //   - 'node_modules/**'     -> 只排除根目录的 node_modules
  //   - '**/node_modules/**'  -> 排除所有层级的 node_modules
  //   - '.git/**'             -> 排除根目录的 .git
  //   - '**/.DS_Store'        -> 排除所有 .DS_Store 文件
  async createTarWithGlobPattern(localTarPath) {
    const pack = tar.pack();
    const gzip = zlib.createGzip();
    const output = fs.createWriteStream(localTarPath);

    // 管道：pack -> gzip -> output
    pack.pipe(gzip).pipe(output);

    // 使用 glob 获取文件，同时应用 globIgnore 排除
    const allFiles = await glob(this.globPattern, {
      cwd: this.localTarget,
      dot: true,
      nodir: false,
      ignore: this.globIgnore,
    });

    const filesToPack = allFiles.sort();

    console.log(`找到 ${filesToPack.length} 个文件/目录需要打包`);
    console.log(`包含模式: ${this.globPattern}`);
    console.log(`排除模式: ${JSON.stringify(this.globIgnore)}`);

    // 逐个添加文件到 tar
    let processed = 0;
    for (const file of filesToPack) {
      const fullPath = path.join(this.localTarget, file);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        pack.entry({ name: file, type: 'directory' });
      } else {
        const content = fs.readFileSync(fullPath);
        pack.entry({ name: file, size: content.length }, content);
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`已处理 ${processed}/${filesToPack.length} 个文件...`);
      }
    }

    return new Promise((resolve, reject) => {
      output.on('finish', () => {
        console.log(`✅ Tar 打包完成: ${localTarPath}`);
        resolve();
      });
      output.on('error', reject);
      pack.finalize();
    });
  }

  // 使用系统 tar 命令打包（旧版，兼容，使用 excludes）
  async createTarWithSystem(localTarPath) {
    let tarCommand = `COPYFILE_DISABLE=1 tar -czvf ${localTarPath} -C ${this.localTarget}`;

    // 先添加所有 excludes
    this.excludes.forEach((item) => {
      tarCommand += ` --exclude='${item}'`;
    });

    // 再添加 includes (如果有的话)
    this.includes.forEach((item) => {
      tarCommand += ` --include='${item}'`;
    });

    // 最后添加要打包的目录
    tarCommand += ' .';

    console.log(`exec(${tarCommand})`);
    await exec(tarCommand);
  }

  async upload() {
    if (this.tar) {
      // 如果是本地模式或没有 SSH 配置，直接生成到项目目录
      const noSSH = !this.deployConfig.ssh_configs || this.deployConfig.ssh_configs.length === 0;
      const localTarPath = (this.deployConfig.localOnly || noSSH)
        ? path.resolve('./build.tar.gz')
        : path.posix.join('/tmp', `build-${crypto.randomBytes(4).toString('hex')}.tar.gz`);

      // 根据配置选择打包方式
      // 如果传了 globIgnore 或 globPattern 不是默认的，使用 Node.js tar-stream
      if (this.globIgnore?.length > 0 || this.globPattern !== '**/*') {
        console.log('使用 Node.js tar-stream 打包（支持 globPattern/globIgnore）...');
        await this.createTarWithGlobPattern(localTarPath);
      } else {
        console.log('使用系统 tar 命令打包...');
        await this.createTarWithSystem(localTarPath);
      }

      // 如果是本地模式，直接返回
      if (this.deployConfig.localOnly) {
        console.log(`✅ 本地打包完成: ${localTarPath}`);

        // 列出打包内容供用户检查
        console.log('\n📦 打包内容预览:');
        const { stdout } = await exec(`tar -tzf ${localTarPath} | head -50`);
        console.log(stdout);
        const { stdout: total } = await exec(`tar -tzf ${localTarPath} | wc -l`);
        console.log(`... 共 ${total.trim()} 个文件\n`);
        return;
      }

      const remoteTarPath = path.posix.join(this.newReleaseDir, 'build.tar.gz');
      console.log(`putFile(${localTarPath}, ${remoteTarPath})`);
      await this.putFile(localTarPath, remoteTarPath);
      await exec(`rm ${localTarPath}`);
      console.log('putFile completed');

      console.log(`execCommand(tar xzvf ${remoteTarPath} -C ${this.newReleaseDir})`);
      await this.execCommand(`tar xzvf ${remoteTarPath} -C ${this.newReleaseDir}`);
      console.log(`execCommand(rm -rf ${remoteTarPath})`);
      await this.execCommand(`rm -rf ${remoteTarPath}`);
    } else {
      await this.uploadDirectory(this.localTarget, this.newReleaseDir, {
        recursive: true,
        concurrency: 1,
      });
      console.log('putDirectory completed');
    }

    await this.execCommand(`ln -sfn ${this.newReleaseDir} ${this.distTarget}`);
    console.log(`${this.distTarget} -> ${this.newReleaseDir} completed`);

    const { stdout } = await this.execCommand(`ls ${this.releasesDir}`);
    const arr = _.sortBy(_.split(stdout, '\n'));
    await this.execCommand(`rm -rf ${_.dropRight(arr, this.versionsRetainedNumber).map(name => path.posix.join(this.releasesDir, name)).join(' ')}`);
    this.afterUpload && (await this.afterUpload(this));
  }

  uploadDirectory(...args) {
    return this.putDirectory(...args);
  }

  static async deploy({ ssh_configs, ...deployConfig }) {
    // 本地模式：如果没有 SSH 配置或使用 globPattern/globIgnore，直接打包
    const hasGlobConfig = deployConfig.globIgnore?.length > 0 || deployConfig.globPattern !== '**/*';
    if (!ssh_configs || ssh_configs.length === 0 || deployConfig.localOnly || hasGlobConfig) {
      const ssh = new this(deployConfig);
      try {
        await ssh.upload();
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
      return;
    }

    for (const sshConfig of ssh_configs) {
      const ssh = new this(deployConfig);
      try {
        const lastSSH = await ssh.connect2(sshConfig);
        console.log('ssh connected');

        await lastSSH.upload();
        ssh.dispose();
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
    }
  }
}

function deploy(config) {
  if (
    config.cosSecretId
    && config.cosSecretKey
    && config.cosBucket
    && config.cosRegion
  ) {
    console.log('使用腾讯云COS');
    return DeployToCos.deploy(config).then(() => NodeSSH.deploy(config));
  } else if (
    config.ossAccessKeyId
    && config.ossAccessKeySecret
    && config.ossBucket
    && config.ossEndpoint
  ) {
    console.log('使用阿里云OSS');
    return DeployToOss.deploy(config).then(() => NodeSSH.deploy(config));
  } else {
    return NodeSSH.deploy(config);
  }
}

if (require.main === module) {
  const deployConfig = require(path.posix.resolve('deploy.config.js'));
  return deploy(deployConfig);
} else {
  module.exports = { NodeSSH, DeployToOss, DeployToCos, deploy };
}
