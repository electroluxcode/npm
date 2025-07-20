import path from "path";
import { move } from "fs-extra";
import { execa } from "execa";
import { readFile, writeFile } from 'fs/promises';
import calculateNextVersion from './calculate-next-version.js';

export default async function (
  npmrc,
  { tarballDir, pkgRoot, isUsePackageVersion = false },
  { cwd, env, stdout, stderr, nextRelease: { version, type }, logger }
) {
  const basePath = pkgRoot ? path.resolve(cwd, pkgRoot) : cwd;

  // 如果启用了基于 package.json 的版本计算
  let finalVersion = version;
  logger.log("isUsePackageVersion: %s, type: %s", isUsePackageVersion, type);
  if (isUsePackageVersion && type) {
    try {
      finalVersion = await calculateNextVersion({ pkgRoot }, { cwd, logger }, type);
      logger.log(`Using package.json-based version calculation: ${finalVersion}`);
    } catch (error) {
      logger.warn(`Failed to calculate version from package.json, falling back to semantic-release version: ${version}`);
      finalVersion = version;
    }
  }

  // Directly modify package.json file to avoid npm version command issues
  try {
    logger.log("Directly modifying package.json file, setting version to: %s", finalVersion);
    const packageJsonPath = path.join(basePath, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    packageJson.version = finalVersion;
    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
    logger.log("Successfully updated package.json version to %s", finalVersion);
  } catch (error) {
    logger.error("Direct package.json modification failed:", error.message);
    
    // If direct modification fails, try using npm version command
    logger.log("Trying npm version command as fallback...");
    try {
      const versionResult = execa(
        "npm",
        ["version", finalVersion, "--userconfig", npmrc, "--no-git-tag-version", "--allow-same-version"],
        {
          cwd: basePath,
          env,
          preferLocal: true,
        }
      );
      versionResult.stdout.pipe(stdout, { end: false });
      versionResult.stderr.pipe(stderr, { end: false });

      await versionResult;
      logger.log("npm version command executed successfully");
    } catch (npmError) {
      logger.error("npm version command also failed:", npmError.message);
      throw error; // Throw the original package.json modification error
    }
  }

  if (tarballDir) {
    logger.log("Creating npm package version %s", finalVersion);
    const packResult = execa("npm", ["pack", basePath, "--userconfig", npmrc], { cwd, env, preferLocal: true });
    packResult.stdout.pipe(stdout, { end: false });
    packResult.stderr.pipe(stderr, { end: false });

    const tarball = (await packResult).stdout.split("\n").pop();
    const tarballSource = path.resolve(cwd, tarball);
    const tarballDestination = path.resolve(cwd, tarballDir.trim(), tarball);

    // Only move the tarball if we need to
    // Fixes: https://github.com/semantic-release/npm/issues/169
    if (tarballSource !== tarballDestination) {
      await move(tarballSource, tarballDestination);
    }
  }
}
