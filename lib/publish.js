import path from "path";
import { execa } from "execa";
import fs from "fs/promises";
import getRegistry from "./get-registry.js";
import getChannel from "./get-channel.js";
import getReleaseInfo from "./get-release-info.js";


/**
 * 
 * @param {*} isReplaceWorkspace 是否替换 workspace 依赖
 * @param {*} is
 */
export default async function (npmrc, { npmPublish, pkgRoot, isReplaceWorkspace = false }, pkg, context) {
  const {
    cwd,
    env,
    stdout,
    stderr,
    nextRelease: { version, channel },
    logger,
  } = context;

  if (npmPublish !== false && pkg.private !== true) {
    const basePath = pkgRoot ? path.resolve(cwd, pkgRoot) : cwd;
    const registry = getRegistry(pkg, context);
    const distTag = getChannel(channel);

    logger.log(`Publishing version ${version} to npm registry on dist-tag ${distTag}`);
    if (isReplaceWorkspace) {
      // 找到package.json中 dependencies/devDependencies/peerDependencies 的workspaces， 将 workspaces 中的 workspace: 换成 *
      const packageJsonPath = path.join(basePath, "package.json");
      
      try {
        // 读取 package.json 文件
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageJsonContent);
        
        // 需要检查的依赖类型
        const dependencyTypes = ['dependencies', 'devDependencies', 'peerDependencies'];
        
        let hasChanges = false;
        
        // 遍历每种依赖类型
        for (const depType of dependencyTypes) {
          if (packageJson[depType]) {
            // 遍历该类型下的所有依赖
            for (const [depName, depVersion] of Object.entries(packageJson[depType])) {
              // 检查版本是否以 workspace: 开头
              if (typeof depVersion === 'string' && depVersion.startsWith('workspace:')) {
                // 将 workspace: 替换为 *
                packageJson[depType][depName] = '*';
                hasChanges = true;
                logger.log(`Replaced ${depName} version from ${depVersion} to * in ${depType}`);
              }
            }
          }
        }
        
        // 如果有更改，写回文件
        if (hasChanges) {
          await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
          logger.log('Updated package.json with workspace dependencies replaced');
        } else {
          logger.log('No workspace dependencies found to replace');
        }
      } catch (error) {
        logger.error(`Error processing package.json: ${error.message}`);
        throw error;
      }
    }
    const result = execa(
      "npm",
      ["publish", basePath, "--userconfig", npmrc, "--tag", distTag, "--registry", registry],
      { cwd, env, preferLocal: true }
    );
    result.stdout.pipe(stdout, { end: false });
    result.stderr.pipe(stderr, { end: false });
    await result;

    logger.log(`Published ${pkg.name}@${version} to dist-tag @${distTag} on ${registry}`);

    return getReleaseInfo(pkg, context, distTag, registry);
  }

  logger.log(
    `Skip publishing to npm registry as ${npmPublish === false ? "npmPublish" : "package.json's private property"} is ${
      npmPublish !== false
    }`
  );

  return false;
}
