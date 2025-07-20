import { castArray, defaultTo } from "lodash-es";
import AggregateError from "aggregate-error";
import { temporaryFile } from "tempy";
import getPkg from "./lib/get-pkg.js";
import verifyNpmConfig from "./lib/verify-config.js";
import verifyNpmAuth from "./lib/verify-auth.js";
import addChannelNpm from "./lib/add-channel.js";
import prepareNpm from "./lib/prepare.js";
import publishNpm from "./lib/publish.js";
import calculateNextVersion from "./lib/calculate-next-version.js";

let verified;
let prepared;
const npmrc = temporaryFile({ name: ".npmrc" });

export async function verifyConditions(pluginConfig, context) {
  // If the npm publish plugin is used and has `npmPublish`, `tarballDir` or `pkgRoot` configured, validate them now in order to prevent any release if the configuration is wrong
  if (context.options.publish) {
    const publishPlugin =
      castArray(context.options.publish).find((config) => config.path && config.path === "semantic-release-monorepo-npm-plugin") || {};

    pluginConfig.npmPublish = defaultTo(pluginConfig.npmPublish, publishPlugin.npmPublish);
    pluginConfig.tarballDir = defaultTo(pluginConfig.tarballDir, publishPlugin.tarballDir);
    pluginConfig.pkgRoot = defaultTo(pluginConfig.pkgRoot, publishPlugin.pkgRoot);
  }

  const errors = verifyNpmConfig(pluginConfig);

  try {
    const pkg = await getPkg(pluginConfig, context);

    // Verify the npm authentication only if `npmPublish` is not false and `pkg.private` is not `true`
    if (pluginConfig.npmPublish !== false && pkg.private !== true) {
      await verifyNpmAuth(npmrc, pkg, context);
    }
  } catch (error) {
    errors.push(...error.errors);
  }

  if (errors.length > 0) {
    throw new AggregateError(errors);
  }

  // 在 verifyConditions 阶段检查是否需要基于 package.json 版本进行版本计算
  const { isUsePackageVersion = false } = pluginConfig;
  const { logger } = context;
  
  logger.log("VerifyConditions stage - isUsePackageVersion: %s", isUsePackageVersion);
  
  if (isUsePackageVersion) {
    try {
      // 从 package.json 读取版本
      const { readFile } = await import('fs/promises');
      const path = await import('path');
      
      const { pkgRoot } = pluginConfig;
      const basePath = pkgRoot ? path.resolve(context.cwd, pkgRoot) : context.cwd;
      const packageJsonPath = path.join(basePath, 'package.json');
      
      const packageJsonContent = await readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonContent);
      
      if (packageJson && packageJson.version) {
        logger.log(`VerifyConditions - Setting lastRelease.version to package.json version: ${packageJson.version}`);
        
        // 设置 context.lastRelease，这样 getNextVersion 会基于这个版本进行计算
        context.lastRelease = {
          version: packageJson.version,
          gitTag: `v${packageJson.version}`,
          gitHead: context.lastRelease?.gitHead || null,
          name: `v${packageJson.version}`,
          channels: [null]
        };
        
        logger.log(`VerifyConditions - Created lastRelease: version=${context.lastRelease.version}, gitTag=${context.lastRelease.gitTag}`);
      } else {
        logger.warn("VerifyConditions - No version found in package.json");
      }
    } catch (error) {
      logger.warn(`VerifyConditions - Failed to read package.json version: ${error.message}`);
    }
  }

  verified = true;
}

export async function prepare(pluginConfig, context) {
  const errors = verified ? [] : verifyNpmConfig(pluginConfig);

  try {
    // Reload package.json in case a previous external step updated it
    const pkg = await getPkg(pluginConfig, context);
    if (!verified && pluginConfig.npmPublish !== false && pkg.private !== true) {
      await verifyNpmAuth(npmrc, pkg, context);
    }
  } catch (error) {
    errors.push(...error.errors);
  }

  if (errors.length > 0) {
    throw new AggregateError(errors);
  }

  // 在 prepare 阶段检查是否需要覆盖版本
  const { isUsePackageVersion = false } = pluginConfig;
  const { nextRelease, logger } = context;
  
  logger.log("Prepare stage - isUsePackageVersion: %s, nextRelease: %s", isUsePackageVersion, nextRelease ? JSON.stringify(nextRelease) : 'undefined');
  
  if (isUsePackageVersion && nextRelease && nextRelease.type) {
    try {
      const calculatedVersion = await calculateNextVersion(pluginConfig, context, nextRelease.type);
      
      logger.log("Calculated version from package.json: %s, current nextRelease.version: %s", calculatedVersion, nextRelease.version);
      
      if (calculatedVersion !== nextRelease.version) {
        logger.log(`Overriding semantic-release version ${nextRelease.version} with package.json-based version ${calculatedVersion}`);
        
        // 修改 nextRelease 对象
        nextRelease.version = calculatedVersion;
        nextRelease.gitTag = `v${calculatedVersion}`;
        
        logger.log(`Updated nextRelease: version=${nextRelease.version}, gitTag=${nextRelease.gitTag}`);
      } else {
        logger.log("Version calculation result matches current version, no override needed");
      }
    } catch (error) {
      logger.warn(`Failed to calculate version from package.json: ${error.message}`);
      logger.warn(`Keeping semantic-release calculated version: ${nextRelease.version}`);
    }
  } else {
    logger.log("Version override conditions not met: isUsePackageVersion=%s, hasNextRelease=%s, hasType=%s", 
      isUsePackageVersion, !!nextRelease, nextRelease ? !!nextRelease.type : false);
  }

  await prepareNpm(npmrc, pluginConfig, context);
  prepared = true;
}

export async function publish(pluginConfig, context) {
  let pkg;
  const errors = verified ? [] : verifyNpmConfig(pluginConfig);

  try {
    // Reload package.json in case a previous external step updated it
    pkg = await getPkg(pluginConfig, context);
    if (!verified && pluginConfig.npmPublish !== false && pkg.private !== true) {
      await verifyNpmAuth(npmrc, pkg, context);
    }
  } catch (error) {
    errors.push(...error.errors);
  }

  if (errors.length > 0) {
    throw new AggregateError(errors);
  }

  if (!prepared) {
    await prepareNpm(npmrc, pluginConfig, context);
  }

  return publishNpm(npmrc, pluginConfig, pkg, context);
}

export async function addChannel(pluginConfig, context) {
  let pkg;
  const errors = verified ? [] : verifyNpmConfig(pluginConfig);

  try {
    // Reload package.json in case a previous external step updated it
    pkg = await getPkg(pluginConfig, context);
    if (!verified && pluginConfig.npmPublish !== false && pkg.private !== true) {
      await verifyNpmAuth(npmrc, pkg, context);
    }
  } catch (error) {
    errors.push(...error.errors);
  }

  if (errors.length > 0) {
    throw new AggregateError(errors);
  }

  return addChannelNpm(npmrc, pluginConfig, pkg, context);
}
