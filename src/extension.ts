import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

function findPackageJson(filePath: string): string | null {
  let dir = path.dirname(filePath);
  while (dir !== path.dirname(dir)) {
    const packageJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function addDependencyToPackageJson(
  packageJsonPath: string,
  packageName: string
) {
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
  }
}

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration();
  const customPackagePrefix = config.get<string>(
    "customPackagePrefix",
    "@wrtn"
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { pattern: "**/*.{ts,js,tsx,jsx}", scheme: "file" },
      {
        provideCodeActions: (document, range, context, token) => {
          const lineText = document.lineAt(range.start.line).text;
          const importMatch = lineText.match(
            new RegExp(
              `import\\s+.*\\s+from\\s+['"](${customPackagePrefix}\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*)['"]`
            )
          );

          if (!importMatch) {
            return;
          }

          const packageName = importMatch[1];
          const command: vscode.Command = {
            title: "Add to package.json and install",
            command: "extension.addDependency",
            arguments: [document.uri.fsPath, packageName],
          };

          const action = new vscode.CodeAction(
            command.title,
            vscode.CodeActionKind.QuickFix
          );
          action.command = command;
          return [action];
        },
      },
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.addDependency",
      async (filePath: string, packageName: string) => {
        const packageJsonPath = findPackageJson(filePath);
        if (!packageJsonPath) {
          vscode.window.showErrorMessage(
            "No package.json found in the workspace."
          );
          return;
        }
        addDependencyToPackageJson(packageJsonPath, packageName);

        const terminal = vscode.window.createTerminal();
        terminal.sendText(`pnpm install`);
        terminal.show();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.installAllDependencies",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("No active editor found.");
          return;
        }

        const document = editor.document;
        const text = document.getText();
        const importRegex = new RegExp(
          `import\\s+.*\\s+from\\s+['"](${customPackagePrefix}\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*)['"]`,
          "g"
        );
        let match;

        const packageJsonPath = findPackageJson(document.uri.fsPath);
        if (!packageJsonPath) {
          vscode.window.showErrorMessage(
            "No package.json found in the workspace."
          );
          return;
        }

        while ((match = importRegex.exec(text)) !== null) {
          const packageName = match[1];
          addDependencyToPackageJson(packageJsonPath, packageName);
        }

        const terminal = vscode.window.createTerminal();
        terminal.sendText(document.fileName);
        terminal.sendText(`pnpm install`);
        terminal.show();
      }
    )
  );
}
