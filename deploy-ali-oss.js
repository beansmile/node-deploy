/* eslint-disable no-console */
const path = require('path');
const crypto = require('crypto');
const OSS = require('ali-oss');
const fs = require('fs-extra');
const glob = require('glob');
const async = require('async');
const _ = require('lodash');
const dayjs = require('dayjs');

class DeployAliOss {
  constructor(config = {}) {
    const {
      ossAccessKeyId,
      ossAccessKeySecret,
      ossBucket,
      ossEndpoint,
      ossTimeout,
      ossNamespace,
      ossPattern,
      versionsRetainedNumber, // 保留的版本数量
    } = config;

    this.config.ossNamespace = ossNamespace || 'frontend';
    this.config.ossPattern = ossPattern || `${path.resolve('dist')}/**/*.!(html)`;
    this.config.versionsRetainedNumber = Math.max(versionsRetainedNumber, 1);

    this.client = new OSS({
      accessKeyId: ossAccessKeyId,
      accessKeySecret: ossAccessKeySecret,
      bucket: ossBucket,
      endpoint: ossEndpoint,
      timeout: ossTimeout || '600s',
    });
  }

  config = {};

  getFiles = (pattern = this.config.ossPattern) => {
    return new Promise((resolve, reject) => {
      glob(pattern, (err, files) => {
        if (err) {
          return reject(err);
        }
        resolve(files);
      });
    });
  };

  clearOldVersionFiles = async () => {
    console.log('开始清理OSS旧版本文件...');
    const { objects } = await this.client.list({
      'prefix': this.config.ossNamespace,
      'max-keys': 1000,
    });
    const objectsGroupedByName = _.groupBy(objects, (item) => {
    // app.4ae2275a.js => app.js
      return item.name.split('.').filter((item) => {
        return !/^[0-9a-z]{8}$/.test(item);
      }).join('.');
    });
    // 最少保留1个版本
    const saveVersion = Math.max(this.versionsRetainedNumber, 1);
    const deleteObjectsNames = _.flatten(
      _.filter(objectsGroupedByName, list => list.length > saveVersion)
        .map(list => list.sort((a, b) => dayjs(a.lastModified).diff(dayjs(b.lastModified))))
        .map(list => list.slice(0, list.length - saveVersion).map(item => item.name)),
    );
    if (deleteObjectsNames.length) {
      console.log('将从OSS删除旧版文件', deleteObjectsNames.join(','));
      await this.client.deleteMulti(deleteObjectsNames);
    }
    console.log('清理OSS旧版本文件完成');
  };

  generateChecksum = async (filePath) => {
    const data = await fs.readFile(filePath);
    return crypto.createHash('md5').update(data).digest('hex');
  };

  uploadFile = async (fileName, filePath) => {
    const checksum = await this.generateChecksum(filePath);
    const upload = async () => {
      console.log(`正在上传文件: ${filePath}`);
      await this.client.put(fileName, filePath, { meta: { checksum } });
    };
    return this.client.head(fileName)
      .then(({ meta }) => {
        if (_.get(meta, 'checksum') !== checksum) {
          return upload();
        }
      })
      .catch((e) => {
        if (e.status === 404) {
          return upload();
        }
        throw e;
      });
  };

  run = async () => {
    const allFiles = await this.getFiles();
    const files = allFiles.filter(item => fs.lstatSync(item).isFile());

    const fileList = files.map(item => ({
      filePath: item,
      fileName: path.join(this.config.ossNamespace, path.relative(path.resolve('dist'), item)),
    }));

    console.log('上传到OSS...');
    await async.eachLimit(fileList, 10, async (item) => {
      await this.uploadFile(item.fileName, item.filePath);
    });
    console.log('上传到OSS完成');
    console.log('清理dist目录...');
    await Promise.all(files.map(item => fs.remove(item)));
    console.log('清理dist目录完成');
    await this.clearOldVersionFiles();
  };

  static deploy = async (config = {}) => {
    const instance = new this(config);
    await instance.run();
  };
}

module.exports = DeployAliOss;
