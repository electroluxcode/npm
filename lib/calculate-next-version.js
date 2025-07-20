import semver from "semver";
import { readFile } from 'fs/promises';
import path from "path";

/**
 * 计算基于 package.json 当前版本的下一版本号
 * @param {Object} pluginConfig - 插件配置
 * @param {Object} context - semantic-release 上下文
 * @param {string} releaseType - 发布类型 (major, minor, patch)
 * @returns {string} 下一版本号
 */
export default async function calculateNextVersion(pluginConfig, context, releaseType) {
  const { cwd, logger } = context;
  const { pkgRoot } = pluginConfig;
  
  const basePath = pkgRoot ? path.resolve(cwd, pkgRoot) : cwd;
  const packageJsonPath = path.join(basePath, 'package.json');
  
  try {
    // 读取 package.json 文件
    const packageJsonContent = await readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    const currentVersion = packageJson.version;
    
    if (!currentVersion) {
      throw new Error('No version found in package.json');
    }
    
    // 验证当前版本格式
    if (!semver.valid(currentVersion)) {
      throw new Error(`Invalid version format in package.json: ${currentVersion}`);
    }
    
    // 根据发布类型计算下一版本号
    let nextVersion;
    switch (releaseType) {
      case 'major':
        nextVersion = semver.inc(currentVersion, 'major');
        break;
      case 'minor':
        nextVersion = semver.inc(currentVersion, 'minor');
        break;
      case 'patch':
        nextVersion = semver.inc(currentVersion, 'patch');
        break;
      default:
        throw new Error(`Invalid release type: ${releaseType}`);
    }
    
    logger.log(`Calculated next version: ${currentVersion} -> ${nextVersion} (${releaseType})`);
    return nextVersion;
    
  } catch (error) {
    logger.error(`Error calculating next version: ${error.message}`);
    throw error;
  }
} 