/* eslint-disable no-console */
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child-process-promise');
const { NodeSSH: OriginNodeSSH } = require('node-ssh');
const _ = require('lodash');
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
    } = this.deployConfig = deployConfig;

    this.afterUpload = afterUpload;
    this.localTarget = local_target;
    this.tar = tar;
    this.includes = includes;
    this.excludes = excludes;
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

  async upload() {
    if (this.tar) {
      const localTarPath = path.posix.join('/tmp', `build-${crypto.randomBytes(4).toString('hex')}.tar.gz`);
      let tarCommand = `COPYFILE_DISABLE=1 tar -czvf ${localTarPath} -C ${this.localTarget}`;
      this.excludes.forEach((item) => {
        tarCommand += ` --exclude='${item}'`;
      });
      this.includes.forEach((item) => {
        tarCommand += ` --include='${item}'`;
      });
      tarCommand += ' .';
      console.log(`exec(${tarCommand})`);
      await exec(tarCommand);
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
