# node-deploy

在项目跟目录下创建 deploy.config.js

h5 项目参考配置
```
const dayjs = require('dayjs')
const path = require('path')

module.exports = {
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

admin 项目参考配置
```
const moment = require('moment')
const path = require('path')

module.exports = {
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
