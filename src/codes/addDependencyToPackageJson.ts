import * as vscode from "vscode";
import * as fs from "fs";

export function addDependencyToPackageJson(
  packageJsonPath: string,
  packageName: string
) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }

    if (!packageJson.dependencies[packageName]) {
      packageJson.dependencies[packageName] = "workspace:*";
      fs.writeFileSync(
        packageJsonPath,
        JSON.stringify(packageJson, null, 2),
        "utf-8"
      );
      return true;
    }
    return false;
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to update package.json: ${error}`);
    return false;
  }
}
