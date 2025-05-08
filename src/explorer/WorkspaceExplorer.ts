import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export interface WorkspacePackage {
  name: string;
  path: string;
  children?: WorkspacePackage[];
  type: "directory" | "package";
}

export class WorkspaceExplorer
  implements vscode.TreeDataProvider<WorkspacePackage>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    WorkspacePackage | undefined | null | void
  > = new vscode.EventEmitter<WorkspacePackage | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    WorkspacePackage | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string) {}

  getTreeItem(element: WorkspacePackage): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.name,
      element.children && element.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    if (element.type === "package") {
      // 더블클릭 시 package.json 열기
      treeItem.command = {
        command: "vscode.open",
        title: "Open Package.json",
        arguments: [vscode.Uri.file(path.join(element.path, "package.json"))],
      };

      treeItem.tooltip = element.path;
      treeItem.contextValue = "packageWithCopy";
      treeItem.id = element.name; // id 속성 사용
    } else {
      treeItem.tooltip = element.path;
    }

    treeItem.iconPath =
      element.type === "directory"
        ? new vscode.ThemeIcon("folder")
        : new vscode.ThemeIcon("package");

    return treeItem;
  }

  async getChildren(element?: WorkspacePackage): Promise<WorkspacePackage[]> {
    if (!this.workspaceRoot) {
      return [];
    }

    if (element) {
      return element.children || [];
    }

    return this.getWorkspacePackages();
  }

  private sortPackages(packages: WorkspacePackage[]): WorkspacePackage[] {
    return packages.sort((a, b) => {
      // 디렉토리를 먼저 정렬
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      // 같은 타입끼리는 이름순으로 정렬
      return a.name.localeCompare(b.name);
    });
  }

  private async getWorkspacePackages(): Promise<WorkspacePackage[]> {
    const workspaceYamlPath = path.join(
      this.workspaceRoot,
      "pnpm-workspace.yaml"
    );

    try {
      const yamlContent = fs.readFileSync(workspaceYamlPath, "utf8");
      const workspaceConfig = yaml.load(yamlContent) as { packages: string[] };
      const packages: WorkspacePackage[] = [];

      // 패키지가 발견된 디렉토리 경로를 저장하는 Set
      const packageDirs = new Set<string>();

      for (const pkgPattern of workspaceConfig.packages) {
        const pkgPaths = await vscode.workspace.findFiles(
          pkgPattern + "/**/package.json",
          "**/node_modules/**"
        );

        // 중첩 패키지를 필터링하기 위한 전처리
        const filteredPaths = pkgPaths.filter((uri) => {
          const dir = path.dirname(uri.fsPath);

          // 현재 디렉토리의 상위 경로를 확인
          let parent = dir;
          while (parent !== this.workspaceRoot) {
            parent = path.dirname(parent);
            // 부모 디렉토리가 이미 패키지로 등록되어 있으면 현재 패키지는 제외
            if (packageDirs.has(parent)) {
              return false;
            }
          }

          // 패키지 디렉토리로 등록
          packageDirs.add(dir);
          return true;
        });

        const packageTree: { [key: string]: WorkspacePackage } = {};

        // 필터링된 패키지 경로만 처리
        for (const pkgJsonUri of filteredPaths) {
          try {
            const pkgJsonContent = fs.readFileSync(pkgJsonUri.fsPath, "utf8");
            const pkgJson = JSON.parse(pkgJsonContent);
            const pkgPath = path.dirname(pkgJsonUri.fsPath);
            const relativePath = path.relative(this.workspaceRoot, pkgPath);
            const pathParts = relativePath.split(path.sep);

            // ...existing code...
            let currentPath = "";
            let currentParent: WorkspacePackage | null = null;

            // 경로의 각 부분을 순회하며 트리 구조 생성
            for (let i = 0; i < pathParts.length; i++) {
              const part = pathParts[i];
              currentPath = currentPath ? path.join(currentPath, part) : part;
              const fullPath = path.join(this.workspaceRoot, currentPath);

              if (!packageTree[currentPath]) {
                const isLastPart = i === pathParts.length - 1;
                const newNode: WorkspacePackage = {
                  name: isLastPart ? pkgJson.name : part,
                  path: fullPath,
                  children: [],
                  type: isLastPart ? "package" : "directory",
                };
                packageTree[currentPath] = newNode;

                if (currentParent) {
                  currentParent.children?.push(newNode);
                  // 추가할 때마다 children 정렬
                  if (currentParent.children) {
                    currentParent.children = this.sortPackages(
                      currentParent.children
                    );
                  }
                } else {
                  packages.push(newNode);
                }
              }
              currentParent = packageTree[currentPath];
            }
          } catch (error) {
            console.error(
              `패키지 처리 중 오류 발생: ${pkgJsonUri.fsPath}`,
              error
            );
          }
        }
      }

      return this.sortPackages(packages);
    } catch (error) {
      vscode.window.showErrorMessage(`워크스페이스 패키지 로딩 실패: ${error}`);
      return [];
    }
  }

  public async getPackages(): Promise<WorkspacePackage[]> {
    const allPackages: WorkspacePackage[] = [];
    await this.collectPackages(allPackages);
    return allPackages.filter((pkg) => pkg.type === "package");
  }

  /**
   * 캐시된 패키지 목록을 반환하는 동기 메서드
   * 주의: 최신 데이터가 아닐 수 있으므로, 확실한 최신 데이터가 필요한 경우 getPackages()를 사용하세요.
   */
  public getCachedPackages(): WorkspacePackage[] {
    // 이미 로드된 패키지가 없으면 빈 배열 반환
    if (!this._cachedPackages) {
      this._cachedPackages = [];
      // 백그라운드에서 패키지 로드 시작
      this.getPackages().then((packages) => {
        this._cachedPackages = packages;
      });
      return [];
    }
    return this._cachedPackages;
  }

  // 캐시된 패키지 목록
  private _cachedPackages: WorkspacePackage[] | null = null;

  /**
   * 모든 패키지를 재귀적으로 수집하여 단일 배열에 추가합니다.
   */
  private async collectPackages(result: WorkspacePackage[]) {
    const rootPackages = await this.getWorkspacePackages();

    const collectChildren = (packages: WorkspacePackage[]) => {
      for (const pkg of packages) {
        result.push(pkg);

        if (pkg.children && pkg.children.length > 0) {
          collectChildren(pkg.children);
        }
      }
    };

    collectChildren(rootPackages);
  }
}
