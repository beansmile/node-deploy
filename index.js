const os = require('os')
const path = require('path')
const { exec } = require('child-process-promise')
const node_ssh = require('node-ssh')
const _ = require('lodash')
const fs = require('fs')

const defaultConfig = {
  username: 'deploy',
  port: '22',
  privateKey: `${os.homedir()}/.ssh/id_rsa`
}

let deployConfigInRoot = null

if (fs.existsSync(path.posix.resolve('deploy.config.js'))) {
  deployConfigInRoot = require(path.posix.resolve('deploy.config.js'))
}

class NodeSSH extends node_ssh {
  constructor({ project_dir, namespace = 'current', release_name, local_target, tar = false }) {
    super()
    this.localTarget = local_target
    this.tar = tar
    this.projectDir = project_dir // /var/www/xxx-frontend
    this.namespace = namespace // app
    this.distTarget = path.posix.join(this.projectDir, this.namespace) // /var/www/xxx-frontend/app
    this.releasesDir = path.posix.join(this.projectDir, [this.namespace, 'releases'].join('-')) // /var/www/xxx-frontend/app-releases
    this.newReleaseDir = path.posix.join(this.releasesDir, release_name) // /var/www/xxx-frontend/app-releases/YYYY-MM-DD_HH_mm
  }

  forwardOut() {
    return new Promise((resolve, reject) => {
      this.connection.forwardOut(...arguments, (err, stream) => {
        if (err) {
          reject(err)
          this.connection.end()
        } else {
          resolve(stream)
        }
      })
    })
  }

  async connect2(config, assignDefault = true) {
    if (assignDefault) config = Object.assign({}, defaultConfig, config)
    await this.connect(config)

    let { forwardOut } = config
    if (forwardOut) {
      forwardOut = Object.assign({}, defaultConfig, forwardOut)
      const stream = await this.forwardOut('127.0.0.1', 22, forwardOut.host, forwardOut.port)
      const ssh = new this.constructor
      return ssh.connect2({
        sock: stream,
        ..._.omit(forwardOut, 'host', 'port'),
      }, false)
    } else {
      return this
    }
  }

  async upload() {
    if (this.tar) {
      const localTarPath = path.posix.join(this.localTarget, 'build.tar')
      await exec(`tar -cvf ${localTarPath} -C ${this.localTarget} .`)
      const remoteTarPath = path.posix.join(this.newReleaseDir, 'build.tar')
      await this.putFile(localTarPath, remoteTarPath)
      console.log('putFile completed')

      await this.execCommand(`tar xvf ${remoteTarPath} -C ${this.newReleaseDir}`)
      await this.execCommand(`rm -rf ${remoteTarPath}`)
    } else {
      await this.uploadDirectory(this.localTarget, this.newReleaseDir, {
        recursive: true,
        concurrency: 1,
      })
      console.log('putDirectory completed')
    }

    await this.execCommand(`ln -sfn ${this.newReleaseDir} ${this.distTarget}`)
    console.log(`${this.distTarget} -> ${this.newReleaseDir} completed`)

    // 只保留最后5个版本
    const { stdout } = await this.execCommand(`ls ${this.releasesDir}`)
    const arr = _.sortBy(_.split(stdout, '\n'))
    await this.execCommand(`rm -rf ${_.dropRight(arr, 5).map(name => path.posix.join(this.releasesDir, name)).join(' ')}`)
    await this.afterUpload()
  }

  uploadDirectory(...args) {
    return this.putDirectory(...args)
  }

  afterUpload() {

  }

  static async deploy({ ssh_configs, ...deployConfig } = deployConfigInRoot) {
    for (const sshConfig of ssh_configs) {
      const ssh = new this(deployConfig)
      try {
        const lastSSH = await ssh.connect2(sshConfig)
        console.log('ssh connected')

        await lastSSH.upload()
        ssh.dispose()
      } catch (err) {
        console.error(err)
        process.exit(1)
      }
    }
  }
}

if (require.main === module) {
  NodeSSH.deploy()
} else {
  module.exports = NodeSSH
}
