# node-deploy
- [使用方式](#使用方式)
- [参数说明](#参数说明)
- [h5 项目参考配置](#h5-项目参考配置)
- [admin 项目参考配置](#admin-项目参考配置)
- [服务器目录说明](#服务器目录说明)
- [只需要上传到阿里云 oss](#只需要上传到阿里云-oss)
- [afterUpload 示例](#afterupload-示例)

### 使用方式
```javascript
  const { DeployToOss, deploy, NodeSSH } = require('node-deploy');
  deploy({
    // 同时上传 oss 和服务器配置
    // .......
  });

  DeployToOss.deploy({
    // 只上传 oss
    // .......
  });

  NodeSSH.deploy({
    // 只上传服务器
    // .......
  });
```

### 参数说明
```javascript
module.exports = {
  ossAccessKeyId,                                      // aliyun oss accessKeyId
  ossAccessKeySecret,                                  // aliyun oss accessKeySecret
  ossBucket,                                           // aliyun oss bucket
  ossEndpoint,                                         // aliyun oss endpoint
  ossTimeout,                                          // （选填）上传aliyun oss 的超时时间, 默认: '600s'
  ossNamespace,                                        // （选填）aliyun oss 上传文件夹，默认: 'frontend'
  ossPattern,                                          // （选填）需要上传aliyun oss的文件，默认: `${path.resolve('dist')}/**/*.!(html)`
  versionsRetainedNumber,                              // （选填）需要保留的版本数量, 默认 1

  // 以下为上传服务器的配置
  project_dir: '/var/www/xxx-frontend',                // 服务器中项目的文件夹路径
  namespace: 'app',                                    // 命名空间
  release_name: dayjs().format('YYYY-MM-DD_HH_mm'),    // 版本名称
  local_target: path.resolve('dist'),                  // uni-app build 后，打包文件的所在位置
  tar: false,                                          // 不开启压缩上传
  includes: [],                                        // （选填）只需要上传的文件
  excludes: [],                                        // （选填）不需要上传的文件
  afterUpload(ssh): Promise<void>,                     // （选填）执行完上传后的回调函数，参考下方 afterUpload 示例
  ssh_configs: [
    {
      host: '0.0.0.0',                                 // 跳板服务器 ip
      port: '22',                                      // (选填) 默认为 22
      forwardOut: {
        host: '0.0.0.0',                               // 实际服务器 ip
      }
    },
  ]
}
```

### h5 项目参考配置
```javascript
const dayjs = require('dayjs')
const path = require('path')

module.exports = {
  // 如需上传到阿里云 oss 需要配置以下参数, 否则可以不配置
  ossAccessKeyId: OSS_ACCESS_KEY_ID,
  ossAccessKeySecret: OSS_ACCESS_KEY_SECRET,
  ossBucket: OSS_BUCKET,
  ossEndpoint: OSS_ENDPOINT,
  ossNamespace: OSS_ASSETS_NAMESPACE,

  // 以下为上传服务器的配置
  project_dir: '/var/www/xxx-frontend', // 服务器中项目的文件夹路径
  namespace: 'app', // 命名空间
  release_name: dayjs().format('YYYY-MM-DD_HH_mm'), // 版本名称
  local_target: path.resolve('dist/build/h5'), // uni-app build 后，打包文件的所在位置
  tar: false, // 不开启压缩上传
  ssh_configs: {
    staging: [
      {
        host: '0.0.0.0', // 服务器 ip，支持多台服务器
        // port: '22', 默认为 22，可以不填写
      },
    ],
    production: [
      {
        host: '0.0.0.0', // 跳板服务器 ip
        port: '44433',
        forwardOut: {
          host: '0.0.0.0', // 实际服务器 ip
        }
      },
    ]
  }[process.env.NODE_ENV]
}
```

### admin 项目参考配置
```javascript
const moment = require('moment')
const path = require('path')

module.exports = {
  // 如需上传到阿里云 oss 需要配置以下参数, 否则可以不配置
  ossAccessKeyId: OSS_ACCESS_KEY_ID,
  ossAccessKeySecret: OSS_ACCESS_KEY_SECRET,
  ossBucket: OSS_BUCKET,
  ossEndpoint: OSS_ENDPOINT,
  ossNamespace: OSS_ASSETS_NAMESPACE,

  // 以下为上传服务器的配置
  project_dir: '/var/www/xxx-frontend',
  namespace: 'admin',
  release_name: moment().format('YYYY-MM-DD_HH_mm'),
  local_target: path.resolve('dist'), // vue-cli build 后，打包文件的所在位置
  tar: true, // 开启压缩上传
  ssh_configs: {
    staging: [
      {
        host: '0.0.0.0', // 服务器 ip，支持多台服务器
        // port: '22', 默认为 22，可以不填写
      },
    ],
    production: [
      {
        host: '0.0.0.0', // 跳板服务器 ip，没有跳板则参考 staging 的配置
        port: '44433',
        forwardOut: {
          host: '0.0.0.0', // 实际服务器 ip
        }
      },
    ]
  }[process.env.NODE_ENV]
}
```

### 服务器目录说明
```
h5 和 admin 都部署时，服务器的目录结构('/var/www/xxx-frontend')
.
├── admin -> /var/www/xxx-frontend/admin-releases/2020-03-20_11_07 //admin 文件是一个软链接，指向admin的最新版本
├── admin-releases
│   ├── 2020-03-17_11_51
│   ├── 2020-03-17_11_56
│   ├── 2020-03-17_15_14
│   ├── 2020-03-17_18_13
│   └── 2020-03-20_11_07
├── app -> /var/www/xxx-frontend/app-releases/2020-03-20_18_53 //app 文件是一个软链接，指向app的最新版本
└── app-releases
    ├── 2020-03-19_11_14
    ├── 2020-03-20_10_50
    ├── 2020-03-20_10_59
    ├── 2020-03-20_11_41
    └── 2020-03-20_18_53
```

### 只需要上传到阿里云 oss
```javascript
const { DeployToOss } = require('node-deploy');

DeployToOss.deploy({
  ossAccessKeyId: OSS_ACCESS_KEY_ID,
  ossAccessKeySecret: OSS_ACCESS_KEY_SECRET,
  ossBucket: OSS_BUCKET,
  ossEndpoint: OSS_ENDPOINT,
  ossNamespace: OSS_ASSETS_NAMESPACE,   // 选填，默认 'frontend'
  ossPattern: `${path.resolve('dist')}/**/*.!(html)`,   // 选填，规则参考 https://www.npmjs.com/package/glob
  ossTimeout: '600s',                  // 选填
});
```

### afterUpload 示例
有时上传完文件后需要执行一些命令，比如安装依赖、重启服务器等，可以在 afterUpload 中执行。
afterUpload 必须返回 Promise 对象，否则可能会被提前关闭。
注意：使用 requestShell 执行的命令，报错不会退出，需要自行确保命令正确。

```javascript
NodeSSH.deploy({
  // ... 其他配置
  afterUpload: async (ssh) => {
    // https://github.com/steelbrain/node-ssh/issues/410
    // ssh.execCommand 和 ssh.exec 命令执行的环境不太一样。所以需要使用 requestShell。
    const shell = await ssh.requestShell();
    return new Promise(resolve => {
      shell.on('data', (data) => {
        console.log(data.toString());
      })
      shell.on('close', () => {
        resolve();
      })
      // 所有 write 命令最后，都需要加上 \n, 否则命令不会执行
      shell.write('cd /var/www/xxxx && pnpm install\n');
      // ...... 其他命名操作
      // 退出 shell
      shell.write('exit\n');
    })
  },
});
```
