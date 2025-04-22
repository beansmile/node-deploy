/* eslint-disable no-console */
const path = require('path');
const crypto = require('crypto');
const COS = require('cos-nodejs-sdk-v5');
const fs = require('fs-extra');
const glob = require('glob');
const async = require('async');
const _ = require('lodash');
const dayjs = require('dayjs');

class DeployTencentCos {
  constructor(config = {}) {
    const {
      cosSecretId,
      cosSecretKey,
      cosBucket,
      cosRegion,
      cosNamespace,
      cosPattern,
      versionsRetainedNumber, // 保留的版本数量
      local_target = path.resolve('dist'),
    } = config;

    this.config = {};
    this.config.cosNamespace = cosNamespace || 'frontend';
    this.config.cosPattern = cosPattern || `${local_target}/**/*.!(html)`;
    this.config.versionsRetainedNumber = Math.max(versionsRetainedNumber, 1);
    this.localTarget = local_target;

    this.client = new COS({
      SecretId: cosSecretId,
      SecretKey: cosSecretKey,
    });

    this.bucket = cosBucket;
    this.region = cosRegion;
  }

  getFiles = (pattern = this.config.cosPattern) => {
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
    console.log('开始清理COS旧版本文件...');
    const data = await new Promise((resolve, reject) => {
      this.client.getBucket({
        Bucket: this.bucket,
        Region: this.region,
        Prefix: this.config.cosNamespace,
        MaxKeys: 1000,
      }, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      });
    });

    const objectsGroupedByName = _.groupBy(data.Contents, (item) => {
      // app.4ae2275a.js => app.js
      return item.Key.split('.').filter((part) => {
        return !/^[0-9a-z]{8}$/.test(part);
      }).join('.');
    });

    // 最少保留1个版本
    const saveVersion = Math.max(this.config.versionsRetainedNumber, 1);
    const deleteObjectsKeys = _.flatten(
      _.filter(objectsGroupedByName, list => list.length > saveVersion)
        .map(list => list.sort((a, b) => dayjs(a.LastModified).diff(dayjs(b.LastModified))))
        .map(list => list.slice(0, list.length - saveVersion).map(item => item.Key)),
    );

    if (deleteObjectsKeys.length) {
      console.log('将从COS删除旧版文件', deleteObjectsKeys.join(','));

      await new Promise((resolve, reject) => {
        this.client.deleteMultipleObject({
          Bucket: this.bucket,
          Region: this.region,
          Objects: deleteObjectsKeys.map(Key => ({ Key })),
        }, (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
      });
    }
    console.log('清理COS旧版本文件完成');
  };

  generateChecksum = async (filePath) => {
    const data = await fs.readFile(filePath);
    return crypto.createHash('md5').update(data).digest('hex');
  };

  uploadFile = async (fileName, filePath) => {
    const checksum = await this.generateChecksum(filePath);

    const upload = async () => {
      console.log(`正在上传文件: ${filePath}`);

      await new Promise((resolve, reject) => {
        this.client.putObject({
          Bucket: this.bucket,
          Region: this.region,
          Key: fileName,
          Body: fs.createReadStream(filePath),
          ContentLength: fs.statSync(filePath).size,
          Metadata: { checksum },
        }, (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
      });
    };

    try {
      const headData = await new Promise((resolve, reject) => {
        this.client.headObject({
          Bucket: this.bucket,
          Region: this.region,
          Key: fileName,
        }, (err, data) => {
          if (err) {
            if (err.statusCode === 404) {
              resolve(null);
            } else {
              reject(err);
            }
            return;
          }
          resolve(data);
        });
      });

      if (!headData || _.get(headData, 'headers.x-cos-meta-checksum') !== checksum) {
        await upload();
      }
    } catch (e) {
      if (e.statusCode === 404) {
        await upload();
      } else {
        throw e;
      }
    }
  };

  run = async () => {
    const allFiles = await this.getFiles();
    const files = allFiles.filter(item => fs.lstatSync(item).isFile());

    const fileList = files.map(item => ({
      filePath: item,
      fileName: path.join(this.config.cosNamespace, path.relative(this.localTarget, item)).replace(/\\/g, '/'),
    }));

    console.log('上传到腾讯云COS...');
    await async.eachLimit(fileList, 10, async (item) => {
      await this.uploadFile(item.fileName, item.filePath);
    });
    console.log('上传到腾讯云COS完成');
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

module.exports = DeployTencentCos;
