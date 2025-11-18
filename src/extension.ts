import * as vscode from "vscode";

let panel: vscode.WebviewPanel | undefined;

// 🔗 LLM 팀에서 제공한 단일 엔드포인트 (8001 포트)
const API_BASE = "http://18.205.229.159:8001";
const REVIEW_API_URL = `${API_BASE}/api/v1/review/`;

export function activate(context: vscode.ExtensionContext) {
  console.log("DKMV Analyzer (React Webview) activated");

  const disposable = vscode.commands.registerCommand(
    "dkmv.analyzeSelection",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("열려 있는 파일이 없습니다.");
        return;
      }

      const selection = editor.selection;
      const hasSelection = !selection.isEmpty;

      const code = hasSelection
        ? editor.document.getText(selection)
        : editor.document.getText();

      if (!code.trim()) {
        vscode.window.showInformationMessage("분석할 코드가 비어 있습니다.");
        return;
      }

      const filePath = editor.document.uri.fsPath;
      const languageId = editor.document.languageId;

      // 웹뷰 패널 생성 (이미 있으면 재사용)
      if (!panel) {
        panel = vscode.window.createWebviewPanel(
          "dkmvAnalyzer",
          "DKMV Analyzer",
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
          }
        );

        panel.webview.html = getWebviewHtml(
          panel.webview,
          context.extensionUri
        );

        // 💌 웹뷰 → 익스텐션 메시지 처리
        panel.webview.onDidReceiveMessage(
          async (message: { type: string; payload?: any }) => {
            if (!message || typeof message !== "object") return;

            // 1) 현재 열린 파일의 전체 코드 다시 가져와서 웹뷰로 보내기
            if (message.type === "REQUEST_FULL_DOCUMENT") {
              const active = vscode.window.activeTextEditor;
              if (!active) {
                panel?.webview.postMessage({
                  type: "ANALYZE_ERROR",
                  payload: "열려 있는 파일이 없습니다.",
                });
                return;
              }

              const fullCode = active.document.getText();
              if (!fullCode.trim()) {
                panel?.webview.postMessage({
                  type: "ANALYZE_ERROR",
                  payload: "현재 파일이 비어 있습니다.",
                });
                return;
              }

              const fullFilePath = active.document.uri.fsPath;
              const fullLanguageId = active.document.languageId;

              panel?.webview.postMessage({
                type: "NEW_CODE",
                payload: {
                  code: fullCode,
                  fileName: active.document.fileName,
                  filePath: fullFilePath,
                  languageId: fullLanguageId,
                  mode: "document",
                },
              });

              return;
            }

            // 2) 분석 요청 처리
            if (message.type === "REQUEST_ANALYZE") {
              const payload = (message.payload ?? {}) as {
                code?: string;
                filePath?: string;
                languageId?: string;
                model?: string; // ← 웹뷰에서 선택한 모델
              };

              const codeSnippet = payload.code ?? "";
              if (!codeSnippet.trim()) {
                panel?.webview.postMessage({
                  type: "ANALYZE_ERROR",
                  payload: "분석할 코드가 비어 있습니다.",
                });
                return;
              }

              const filePathForReq = payload.filePath ?? filePath;
              const languageForReq = payload.languageId ?? languageId;
              const modelForReq = payload.model ?? undefined;

              try {
                panel?.webview.postMessage({
                  type: "ANALYZE_PROGRESS",
                  payload: "DKMV LLM에 코드 분석을 요청 중입니다...",
                });

                const body: any = {
                  code_snippet: codeSnippet,
                  language: languageForReq,
                  file_path: filePathForReq,
                };

                // 백엔드가 model 필드를 받도록 되어 있다면 함께 전송
                if (modelForReq) {
                  body.model = modelForReq;
                }

                const response = await fetch(REVIEW_API_URL, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(body),
                });

                if (!response.ok) {
                  const text = await response.text();
                  throw new Error(`HTTP ${response.status}: ${text}`);
                }

                const data = (await response.json()) as unknown;

                panel?.webview.postMessage({
                  type: "ANALYZE_RESULT",
                  payload: data,
                });
              } catch (error) {
                const messageText =
                  error instanceof Error
                    ? error.message
                    : "서버 요청 중 알 수 없는 오류가 발생했습니다.";
                panel?.webview.postMessage({
                  type: "ANALYZE_ERROR",
                  payload: messageText,
                });
              }
            }
          },
          undefined,
          context.subscriptions
        );

        panel.onDidDispose(
          () => {
            panel = undefined;
          },
          null,
          context.subscriptions
        );
      } else {
        panel.reveal(vscode.ViewColumn.Beside);
      }

      // 처음 명령 실행 시: 현재 코드 웹뷰에 전달
      panel.webview.postMessage({
        type: "NEW_CODE",
        payload: {
          code,
          fileName: editor.document.fileName,
          filePath,
          languageId,
          mode: hasSelection ? "selection" : "document",
        },
      });
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}

function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "webview.js")
  );
  const logoUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "logo.png")
  );

  const nonce = getNonce();

  return /* html */ `
    <!DOCTYPE html>
    <html lang="ko">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>DKMV Analyzer</title>
      </head>
      <body>
        <div id="root"></div>

        <script nonce="${nonce}">
          (function () {
            if (typeof window.process === "undefined") {
              // @ts-ignore
              window.process = { env: { NODE_ENV: "production" } };
            }
            window.__DKMV_LOGO__ = "${logoUri}";
          })();
        </script>

        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>
  `;
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
