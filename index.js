const os = require('os')
const path = require('path')
const node_ssh = require('node-ssh')
const _ = require('lodash')
const { ssh_configs, project_dir, namespace = '', release_name, local_target, tar = false } = require(path.resolve('deploy.config'))

const default_config = {
  username: 'deploy',
  port: '22',
  privateKey: `${os.homedir()}/.ssh/id_rsa`
}

class NodeSSH extends node_ssh {
  constructor() {
    super()
    this.project_dir = project_dir
    this.namespace = namespace
    this.dist_target = path.join(this.project_dir, this.namespace, 'current')
    this.releases_dir = path.join(this.project_dir, this.namespace, 'releases')
    this.new_release_dir = path.join(this.releases_dir, release_name)
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

  async connect2(config, assign_default = true) {
    if (assign_default) config = Object.assign({}, default_config, config)
    await this.connect(config)

    let { forwardOut } = config
    if (forwardOut) {
      forwardOut = Object.assign({}, default_config, forwardOut)
      const stream = await this.forwardOut('127.0.0.1', 22, forwardOut.host, forwardOut.port)
      const ssh = new NodeSSH
      return ssh.connect2({
        sock: stream,
        ..._.omit(forwardOut, 'host', 'port'),
      }, false)
    } else {
      return this
    }
  }

  async upload() {
    if (tar) {
      const tar_path = path.join(this.new_release_dir, 'build.tar')
      await this.putFile(local_target, tar_path)
      console.log('putFile completed')

      await this.execCommand(`tar xvf ${tar_path} -C ${this.new_release_dir}`)
      await this.execCommand(`rm -rf ${tar_path}`)
    } else {
      await this.putDirectory(local_target, this.new_release_dir, {
        recursive: true,
        concurrency: 1,
      })
      console.log('putDirectory completed')
    }

    await this.execCommand(`ln -sfn ${this.new_release_dir} ${this.dist_target}`)

    // 只保留最后5个版本
    const { stdout } = await this.execCommand(`ls ${this.releases_dir}`)
    const arr = _.sortBy(_.split(stdout, '\n'))
    await this.execCommand(`rm -rf ${_.dropRight(arr, 5).map(name => path.join(this.releases_dir, name)).join(' ')}`)
  }

  static deploy() {
    ssh_configs.map(async config => {
      const ssh = new NodeSSH
      try {
        const last_ssh = await ssh.connect2(config)
        console.log('ssh connected')

        await last_ssh.upload()
        ssh.dispose()
      } catch (err) {
        console.error(err)
        process.exit(1)
      }
    })
  }
}

NodeSSH.deploy()
