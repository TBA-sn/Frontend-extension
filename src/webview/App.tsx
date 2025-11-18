import React, { useEffect, useState } from "react";
import { Bug, Wrench, Palette, Shield } from "lucide-react";

declare global {
  interface Window {
    acquireVsCodeApi?: () => any;
    __DKMV_LOGO__?: string;
  }
}

type IncomingMessage =
  | {
      type: "NEW_CODE";
      payload: {
        code: string;
        fileName: string;
        filePath: string;
        languageId: string;
        mode: "selection" | "document";
      };
    }
  | { type: "ANALYZE_PROGRESS"; payload: string }
  | { type: "ANALYZE_RESULT"; payload: any }
  | { type: "ANALYZE_ERROR"; payload: string }
  | { type: string; payload?: any };

const vscode = window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;

type ScoreCategories = {
  bug: number;
  maintainability: number;
  style: number;
  security: number;
};

const EMPTY_CATEGORIES: ScoreCategories = {
  bug: 0,
  maintainability: 0,
  style: 0,
  security: 0,
};

type TabId = "code" | "result";

export const App: React.FC = () => {
  const logoSrc = window.__DKMV_LOGO__ ?? "/logo.png";

  const [code, setCode] = useState("");
  const [filePath, setFilePath] = useState<string>("");
  const [languageId, setLanguageId] = useState<string>("plaintext");
  const [mode, setMode] = useState<"selection" | "document" | null>(null);

  const [isLoading, setIsLoading] = useState(false);

  // 탭 상태
  const [activeTab, setActiveTab] = useState<TabId>("code");

  // 분석 결과/상태
  const [resultMessage, setResultMessage] = useState<string>(
    "분석 결과가 이 영역에 표시됩니다."
  );
  const [resultData, setResultData] = useState<any | null>(null);

  // 하이라이트
  const [codeHighlight, setCodeHighlight] = useState(false);
  const [resultHighlight, setResultHighlight] = useState(false);

  // UX 상태
  const [hasNewResult, setHasNewResult] = useState(false);
  const [isError, setIsError] = useState(false);

  // 모델 선택
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelError, setModelError] = useState(false);

  // 애니메이션용 점수 상태 (표시용)
  const [displayOverallScore, setDisplayOverallScore] = useState(0);
  const [displayCategoryScores, setDisplayCategoryScores] =
    useState<ScoreCategories>(EMPTY_CATEGORIES);

  const flashCodeHighlight = () => {
    setCodeHighlight(true);
    setTimeout(() => setCodeHighlight(false), 350);
  };

  const flashResultHighlight = () => {
    setResultHighlight(true);
    setTimeout(() => setResultHighlight(false), 350);
  };

  const clampScore = (s: any): number => {
    if (typeof s !== "number") {
      const parsed = Number(s);
      if (Number.isNaN(parsed)) return 0;
      s = parsed;
    }
    if (s >= 0 && s <= 1) s = s * 100;
    if (s < 0) s = 0;
    if (s > 100) s = 100;
    return Math.round(s);
  };

  const getScoreLabel = (score: number): { label: string; color: string } => {
    if (score >= 90) return { label: "Excellent", color: "#a3e635" };
    if (score >= 70) return { label: "Good", color: "#4ade80" };
    if (score >= 40) return { label: "Okay", color: "#fbbf24" };
    if (score > 0) return { label: "Needs Work", color: "#f97373" };
    return { label: "—", color: "#6b7280" };
  };

  const handleCopyText = (text: string) => {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        alert("클립보드 복사에 실패했습니다.");
      });
    } else {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.style.position = "fixed";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.select();
      try {
        document.execCommand("copy");
      } catch {
        alert("클립보드 복사에 실패했습니다.");
      } finally {
        document.body.removeChild(temp);
      }
    }
  };

  const handleCopyReview = (reviewText: string | null) => {
    if (!reviewText) return;
    handleCopyText(reviewText);
  };

  const handleCopyJson = (data: any) => {
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    handleCopyText(json);
  };

  // VSCode → 웹뷰 메시지 핸들링
  useEffect(() => {
    const handler = (event: MessageEvent<IncomingMessage>) => {
      const message = event.data;
      if (!message) return;

      if (message.type === "NEW_CODE") {
        const { code, filePath, languageId, mode } = message.payload;

        setCode(code);
        setFilePath(filePath);
        setLanguageId(languageId);
        setMode(mode);
        setIsLoading(false);
        setResultData(null);
        setResultMessage(
          "코드를 받았습니다. 모델을 선택한 뒤 [분석] 버튼 또는 Ctrl+Enter로 리뷰를 시작하세요."
        );
        setDisplayOverallScore(0);
        setDisplayCategoryScores(EMPTY_CATEGORIES);
        setActiveTab("code");
        flashCodeHighlight();
        setHasNewResult(false);
        setIsError(false);
      }

      if (message.type === "ANALYZE_PROGRESS") {
        setIsLoading(true);
        setResultMessage(message.payload || "모델이 코드를 읽고 있습니다...");
        // 이미 handleAnalyze에서 result 탭으로 전환하지만,
        // 혹시 모를 상황을 대비해 한 번 더 보정
        setActiveTab("result");
        setIsError(false);
      }

      if (message.type === "ANALYZE_ERROR") {
        setIsLoading(false);
        setResultData(null);
        setResultMessage(`오류 발생: ${message.payload}`);
        setDisplayOverallScore(0);
        setDisplayCategoryScores(EMPTY_CATEGORIES);
        setActiveTab("result");
        setIsError(true);
        setHasNewResult(false);
      }

      if (message.type === "ANALYZE_RESULT") {
        setIsLoading(false);
        const data = message.payload;
        setResultData(data);
        setResultMessage("분석이 완료되었습니다.");
        setActiveTab("result");
        flashResultHighlight();
        setHasNewResult(true);
        setIsError(false);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // 🔹 현재 파일 전체 코드 버튼: 지금은 안내만
  const handleLoadFullDocument = () => {
    setResultMessage("현재 파일 전체 가져오기는 추후 구현 예정입니다.");
    setIsError(false);
    setHasNewResult(false);
  };

  const handleAnalyze = () => {
    if (!code.trim()) {
      setResultMessage(
        "분석할 코드가 없습니다. VS Code에서 코드를 선택 후 실행하거나 왼쪽에 코드를 붙여넣어 주세요."
      );
      setResultData(null);
      setDisplayOverallScore(0);
      setDisplayCategoryScores(EMPTY_CATEGORIES);
      setIsError(false);
      setHasNewResult(false);
      // 코드 없을 땐 굳이 탭 이동 X (현재 탭 그대로)
      return;
    }

    // 모델 미선택 → 에러 메시지만, 탭 이동 X
    if (!selectedModel) {
      setResultMessage("사용할 모델을 먼저 선택해 주세요.");
      setResultData(null);
      setDisplayOverallScore(0);
      setDisplayCategoryScores(EMPTY_CATEGORIES);
      setIsError(true);
      setHasNewResult(false);
      setModelError(true);
      return;
    }

    if (!vscode) {
      setResultMessage("VS Code API를 사용할 수 없습니다.");
      setResultData(null);
      setDisplayOverallScore(0);
      setDisplayCategoryScores(EMPTY_CATEGORIES);
      setIsError(true);
      setHasNewResult(false);
      return;
    }

    setIsLoading(true);
    setResultMessage("리뷰 요청을 준비 중입니다...");
    setIsError(false);
    setHasNewResult(false);
    // 🔹 분석 버튼 누르는 순간 결과 탭으로 전환
    setActiveTab("result");

    vscode.postMessage({
      type: "REQUEST_ANALYZE",
      payload: {
        code,
        filePath,
        languageId,
        model: selectedModel,
      },
    });
  };

  const handleCodeKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!isLoading) {
        handleAnalyze();
      }
    }
  };

  const handleCodeChange = (value: string) => {
    setCode(value);
    flashCodeHighlight();
  };

  // 결과 데이터에서 점수/리뷰 추출 + 점수 애니메이션
  useEffect(() => {
    if (!resultData) {
      setDisplayOverallScore(0);
      setDisplayCategoryScores(EMPTY_CATEGORIES);
      return;
    }

    const rawOverall = resultData.quality_score;
    const scoresByCategory = resultData.scores_by_category ?? {};

    const targetOverall = clampScore(rawOverall);
    const targetCategories: ScoreCategories = {
      bug: clampScore(scoresByCategory.bug),
      maintainability: clampScore(scoresByCategory.maintainability),
      style: clampScore(scoresByCategory.style),
      security: clampScore(scoresByCategory.security),
    };

    const duration = 500;
    const frameMs = 16;
    const steps = Math.max(1, Math.round(duration / frameMs));
    let currentStep = 0;

    setDisplayOverallScore(0);
    setDisplayCategoryScores(EMPTY_CATEGORIES);

    const intervalId = window.setInterval(() => {
      currentStep += 1;
      const t = Math.min(1, currentStep / steps);
      const ease = t * t * (3 - 2 * t); // smoothstep

      setDisplayOverallScore(Math.round(targetOverall * ease));
      setDisplayCategoryScores({
        bug: Math.round(targetCategories.bug * ease),
        maintainability: Math.round(targetCategories.maintainability * ease),
        style: Math.round(targetCategories.style * ease),
        security: Math.round(targetCategories.security * ease),
      });

      if (t >= 1) {
        window.clearInterval(intervalId);
      }
    }, frameMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [resultData]);

  const reviewText: string | null = (() => {
    if (!resultData) return null;
    const v = resultData.review_summary;
    if (!v) return null;
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  })();

  // JSON 트리 렌더링 (디버깅/원본 보기용)
  const renderJsonTree = (value: any, depth = 0): JSX.Element => {
    const indent = depth * 12;

    if (value === null) {
      return <span style={{ color: "#6b7280" }}>null</span>;
    }

    const type = typeof value;

    if (type === "string") {
      return <span style={{ color: "#a7f3d0" }}>"{value}"</span>;
    }

    if (type === "number" || type === "boolean") {
      return <span style={{ color: "#fde68a" }}>{String(value)}</span>;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return <span style={{ color: "#6b7280" }}>[ ]</span>;
      }
      return (
        <div style={{ marginLeft: indent }}>
          {value.map((item, idx) => (
            <div key={idx} style={{ marginBottom: 2 }}>
              <span style={{ color: "#4b5563" }}>[{idx}] </span>
              {renderJsonTree(item, depth + 1)}
            </div>
          ))}
        </div>
      );
    }

    if (type === "object") {
      const entries = Object.entries(value as Record<string, any>);
      if (entries.length === 0) {
        return <span style={{ color: "#6b7280" }}>{"{ }"}</span>;
      }
      return (
        <div style={{ marginLeft: indent }}>
          {entries.map(([key, val]) => (
            <div key={key} style={{ marginBottom: 2 }}>
              <span style={{ color: "#a5b4fc", fontWeight: 500 }}>{key}</span>
              <span style={{ color: "#6b7280" }}> : </span>
              {renderJsonTree(val, depth + 1)}
            </div>
          ))}
        </div>
      );
    }

    return <span>{String(value)}</span>;
  };

  const fileName = filePath ? filePath.split(/[\\/]/).slice(-1)[0] : "";

  const renderTabButton = (id: TabId, label: string) => {
    const isActive = activeTab === id;
    const showBadge = id === "result" && hasNewResult;
    const disabled = isLoading && !isActive; // 로딩 중엔 다른 탭 잠금

    return (
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setActiveTab(id);
          if (id === "result") {
            setHasNewResult(false);
          }
        }}
        style={{
          padding: "6px 12px",
          fontSize: 12,
          border: "none",
          borderBottom: isActive
            ? "2px solid rgba(168,85,247,0.95)"
            : "2px solid transparent",
          backgroundColor: isActive ? "rgba(15,23,42,0.95)" : "transparent",
          color: disabled
            ? "rgba(75,85,99,0.85)"
            : isActive
            ? "#e5e7eb"
            : "#9ca3af",
          cursor: disabled ? "not-allowed" : "pointer",
          outline: "none",
          transition:
            "color 0.12s ease, border-bottom-color 0.12s ease, background-color 0.12s ease",
          display: "flex",
          alignItems: "center",
          gap: 6,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span>{label}</span>
        {showBadge && !disabled && (
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: "#a855f7",
            }}
          />
        )}
      </button>
    );
  };

  const lineCount = code ? code.split(/\r\n|\r|\n/).length : 0;
  const charCount = code.length;
  const overallLabel = getScoreLabel(displayOverallScore);

  return (
    <>
      {/* 로딩 / 그리드 / 로고 애니메이션 스타일 (이전 스타일 그대로) */}
      <style>
        {`
          @keyframes dkmv-logo-pulse {
            0% {
              filter: hue-rotate(0deg) brightness(1);
              transform: scale(1);
            }
            50% {
              filter: hue-rotate(20deg) brightness(1.15);
              transform: scale(1.03);
            }
            100% {
              filter: hue-rotate(-15deg) brightness(0.95);
              transform: scale(1);
            }
          }

          /* 로딩 텍스트 숨쉬기 + 점점점 애니메이션 */
          @keyframes dkmv-loading-text-pulse {
            0% { opacity: 0.4; }
            50% { opacity: 1; }
            100% { opacity: 0.4; }
          }

          @keyframes dkmv-loading-dots {
            0%   { content: ""; }
            33%  { content: "."; }
            66%  { content: ".."; }
            100% { content: "..."; }
          }

          .dkmv-loading-text {
            letter-spacing: 0.03em;
            animation: dkmv-loading-text-pulse 1.4s ease-in-out infinite;
          }

          .dkmv-loading-text::after {
            content: "";
            animation: dkmv-loading-dots 1.2s steps(1, end) infinite;
          }

          .dkmv-score-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }
          @media (max-width: 520px) {
            .dkmv-score-grid {
              grid-template-columns: 1fr;
            }
          }
        `}
      </style>

      <div
        style={{
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          height: "100vh",
          boxSizing: "border-box",
          background:
            "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(15,23,42,0.98))",
          color: "#e5e7eb",
        }}
      >
        {/* 헤더: 로고 + 타이틀 + 모델 선택 + 분석 버튼 */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            paddingBottom: 6,
            borderBottom: "1px solid rgba(148,163,184,0.3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src={logoSrc}
              alt="Don't Kill My Vibe"
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                objectFit: "contain",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: 0.3,
                }}
              >
                Don&apos;t Kill My Vibe
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <select
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
                setModelError(false);
                setIsError(false);
              }}
              style={{
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 999,
                border: modelError
                  ? "1px solid rgba(248,113,113,0.9)"
                  : "1px solid rgba(55,65,81,0.9)",
                backgroundColor: "rgba(15,23,42,0.95)",
                color: "#e5e7eb",
                outline: "none",
                maxWidth: 190,
              }}
            >
              <option value="">모델 선택</option>
              <option value="gpt-4.1-mini">GPT-4.1 mini (빠른 리뷰)</option>
              <option value="gpt-4.1">GPT-4.1 (밸런스)</option>
              <option value="o3-mini">o3-mini (깊은 분석)</option>
            </select>

            <button
              onClick={handleAnalyze}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                borderRadius: 999,
                border: "1px solid rgba(168,85,247,0.9)",
                background: isLoading
                  ? "linear-gradient(90deg,#7c3aed,#5b21b6)"
                  : "linear-gradient(90deg,#a855f7,#7c3aed)",
                color: "white",
                cursor: isLoading ? "default" : "pointer",
                opacity: isLoading ? 0.85 : 1,
                transition:
                  "transform 0.08s ease, opacity 0.12s ease, border-color 0.12s ease",
              }}
              disabled={isLoading}
              onMouseDown={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "translateY(1px)";
              }}
              onMouseUp={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "translateY(0)";
              }}
            >
              {isLoading ? "분석 중..." : "분석 (Ctrl+Enter)"}
            </button>
          </div>
        </header>

        {/* 탭 헤더 */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid rgba(31,41,55,0.9)",
            gap: 4,
            paddingTop: 2,
          }}
        >
          {renderTabButton("code", "입력 코드")}
          {renderTabButton("result", "분석 결과")}
        </div>

        {/* 공통 상태 메시지 바 (탭과 상관없이 항상 표시) */}
        <div
          style={{
            marginTop: 6,
            marginBottom: 4,
            fontSize: 11,
            color: isError ? "#fca5a5" : isLoading ? "#e5e7eb" : "#9ca3af",
            minHeight: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{resultMessage}</span>
          {selectedModel && (
            <span
              style={{
                fontSize: 10,
                color: "#a5b4fc",
                opacity: 0.9,
              }}
            >
              사용 모델: {selectedModel}
            </span>
          )}
        </div>

        {/* 탭 콘텐츠 영역 */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            marginTop: 2,
          }}
        >
          {activeTab === "code" && (
            <section
              style={{
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                borderRadius: 10,
                border: "none",
                background:
                  "radial-gradient(circle at top, rgba(37,99,235,0.18), transparent 60%), #020617",
                padding: 10,
                height: "100%",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    gap: 6,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {mode && (
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "1px solid rgba(55,65,81,0.9)",
                        fontSize: 10,
                        color: "#9ca3af",
                      }}
                    >
                      {mode === "selection" ? "선택 영역" : "전체 문서"}
                    </span>
                  )}
                  {fileName && (
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "1px solid rgba(55,65,81,0.9)",
                        fontSize: 10,
                        color: "#9ca3af",
                      }}
                    >
                      {fileName}
                    </span>
                  )}
                </div>

                {/* 현재 파일 전체 코드 가져오기 버튼 (임시) */}
                <button
                  type="button"
                  onClick={handleLoadFullDocument}
                  style={{
                    fontSize: 10,
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: "1px solid rgba(55,65,81,0.9)",
                    backgroundColor: "rgba(15,23,42,0.9)",
                    color: "#e5e7eb",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  현재 파일 전체 가져오기
                </button>
              </div>

              <textarea
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                onKeyDown={handleCodeKeyDown}
                placeholder="VS Code에서 코드를 선택 후 명령을 실행하거나, 이곳에 분석할 코드를 붙여넣어 주세요."
                style={{
                  flex: 1,
                  width: "100%",
                  resize: "none",
                  fontFamily: "JetBrains Mono, Consolas, monospace",
                  fontSize: 12,
                  lineHeight: 1.5,
                  padding: 10,
                  borderRadius: 6,
                  border: codeHighlight
                    ? "1px solid rgba(168,85,247,0.95)"
                    : "1px solid rgba(75,85,99,0.9)",
                  boxSizing: "border-box",
                  backgroundColor: "#020617",
                  color: "#e5e7eb",
                  outline: "none",
                  transition: "border-color 0.18s ease-out",
                }}
              />
              <div
                style={{
                  marginTop: 4,
                  textAlign: "right",
                  fontSize: 10,
                  color: "#6b7280",
                }}
              >
                {lineCount} lines · {charCount} chars
              </div>
            </section>
          )}

          {activeTab === "result" && (
            <section
              style={{
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                borderRadius: 10,
                border: "none",
                background:
                  "radial-gradient(circle at top, rgba(147,51,234,0.22), transparent 60%), #020617",
                padding: 10,
                position: "relative",
                overflow: "hidden",
                height: "100%",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  flex: 1,
                  borderRadius: 6,
                  border: isError
                    ? "1px solid rgba(239,68,68,0.9)"
                    : resultHighlight
                    ? "1px solid rgba(168,85,247,0.95)"
                    : "1px solid rgba(75,85,99,0.9)",
                  backgroundColor: "#020617",
                  padding: 10,
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  position: "relative",
                  overflow: "hidden",
                  transition: "border-color 0.18s ease-out",
                }}
              >
                {/* blur 되는 내용 */}
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    filter: isLoading ? "blur(3px)" : "none",
                    opacity: isLoading ? 0.7 : 1,
                    transition: "filter 0.2s ease-out, opacity 0.2s ease-out",
                  }}
                >
                  {/* 총점 섹션 */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: "#e5e7eb",
                        }}
                      >
                        총점
                      </span>
                      {resultData && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              color: "#e5e7eb",
                              fontWeight: 600,
                            }}
                          >
                            {displayOverallScore} / 100
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              padding: "2px 8px",
                              borderRadius: 999,
                              border: "1px solid rgba(55,65,81,0.9)",
                              color: overallLabel.color,
                              backgroundColor: "rgba(15,23,42,0.9)",
                            }}
                          >
                            {overallLabel.label}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 유형별 점수 섹션 */}
                    {resultData && (
                      <>
                        <div
                          style={{
                            height: 1,
                            backgroundColor: "rgba(31,41,55,0.95)",
                            margin: "6px 0",
                          }}
                        />
                        <div className="dkmv-score-grid">
                          {(
                            [
                              {
                                key: "bug",
                                label: "Bug",
                                icon: Bug,
                              },
                              {
                                key: "maintainability",
                                label: "Maintainability",
                                icon: Wrench,
                              },
                              {
                                key: "style",
                                label: "Style",
                                icon: Palette,
                              },
                              {
                                key: "security",
                                label: "Security",
                                icon: Shield,
                              },
                            ] as const
                          ).map(({ key, label, icon: Icon }) => {
                            const value =
                              displayCategoryScores[
                                key as keyof ScoreCategories
                              ] ?? 0;
                            const radius = 18;
                            const strokeWidth = 4;
                            const circumference = 2 * Math.PI * radius;
                            const clamped = Math.max(0, Math.min(100, value));
                            const offset = circumference * (1 - clamped / 100);
                            const strokeColor = "#a855f7";

                            return (
                              <div
                                key={key}
                                style={{
                                  borderRadius: 8,
                                  border: "1px solid rgba(31,41,55,0.95)",
                                  backgroundColor: "rgba(15,23,42,0.9)",
                                  padding: 8,
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 6,
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                  >
                                    <Icon
                                      size={14}
                                      color="#a5b4fc"
                                      strokeWidth={1.8}
                                    />
                                    <span
                                      style={{
                                        fontSize: 11,
                                        color: "#e5e7eb",
                                      }}
                                    >
                                      {label}
                                    </span>
                                  </div>
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    marginTop: 4,
                                  }}
                                >
                                  <div
                                    style={{
                                      position: "relative",
                                      width: 48,
                                      height: 48,
                                    }}
                                  >
                                    <svg
                                      width={48}
                                      height={48}
                                      viewBox="0 0 48 48"
                                    >
                                      <circle
                                        cx="24"
                                        cy="24"
                                        r={radius}
                                        stroke="rgba(31,41,55,1)"
                                        strokeWidth={strokeWidth}
                                        fill="none"
                                      />
                                      <circle
                                        cx="24"
                                        cy="24"
                                        r={radius}
                                        stroke={strokeColor}
                                        strokeWidth={strokeWidth}
                                        fill="none"
                                        strokeDasharray={circumference}
                                        strokeDashoffset={offset}
                                        strokeLinecap="round"
                                        transform="rotate(-90 24 24)"
                                        style={{
                                          transition:
                                            "stroke-dashoffset 0.1s linear",
                                        }}
                                      />
                                    </svg>
                                    <div
                                      style={{
                                        position: "absolute",
                                        inset: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 10,
                                        color: "#e5e7eb",
                                      }}
                                    >
                                      {clamped}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  {/* 리뷰 섹션 */}
                  <div
                    style={{
                      height: 1,
                      backgroundColor: "rgba(31,41,55,0.95)",
                      margin: "2px 0 4px",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: "#e5e7eb",
                        }}
                      >
                        리뷰
                      </span>
                      {reviewText && (
                        <button
                          type="button"
                          onClick={() => handleCopyReview(reviewText)}
                          style={{
                            fontSize: 10,
                            padding: "2px 8px",
                            borderRadius: 999,
                            border: "1px solid rgba(55,65,81,0.9)",
                            backgroundColor: "rgba(15,23,42,0.9)",
                            color: "#9ca3af",
                            cursor: "pointer",
                          }}
                        >
                          복사
                        </button>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#d1d5db",
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.4,
                        minHeight: 48,
                      }}
                    >
                      {reviewText
                        ? reviewText
                        : resultData
                        ? "리뷰 요약이 응답에 포함되어 있지 않습니다."
                        : "아직 분석 결과가 없습니다. 코드를 분석하면 이곳에 리뷰가 표시됩니다."}
                    </div>
                  </div>

                  {/* 원본 JSON 섹션 */}
                  {resultData && (
                    <>
                      <div
                        style={{
                          height: 1,
                          backgroundColor: "rgba(31,41,55,0.95)",
                          margin: "4px 0 4px",
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          minHeight: 40,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 500,
                              color: "#e5e7eb",
                            }}
                          >
                            원본 JSON
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyJson(resultData)}
                            style={{
                              fontSize: 10,
                              padding: "2px 8px",
                              borderRadius: 999,
                              border: "1px solid rgba(55,65,81,0.9)",
                              backgroundColor: "rgba(15,23,42,0.9)",
                              color: "#9ca3af",
                              cursor: "pointer",
                            }}
                          >
                            복사
                          </button>
                        </div>
                        <div
                          style={{
                            flex: 1,
                            fontFamily: "monospace",
                            fontSize: 11,
                            color: "#d1d5db",
                            overflow: "auto",
                            whiteSpace: "pre-wrap",
                            borderRadius: 4,
                            border: "1px solid rgba(55,65,81,0.9)",
                            padding: 6,
                            backgroundColor: "#020617",
                            maxHeight: 150,
                          }}
                        >
                          {renderJsonTree(resultData)}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* 로딩 오버레이 – 예전 스타일 그대로 */}
                {isLoading && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      background:
                        "radial-gradient(circle at center, rgba(15,23,42,0.9), rgba(15,23,42,0.96))",
                      pointerEvents: "none",
                      gap: 10,
                    }}
                  >
                    <img
                      src={logoSrc}
                      alt="Loading..."
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: 16,
                        objectFit: "contain",
                        animation: "dkmv-logo-pulse 1.4s ease-in-out infinite",
                      }}
                    />
                    <span
                      className="dkmv-loading-text"
                      style={{
                        fontSize: 12,
                        color: "#e5e7eb",
                      }}
                    >
                      코드의 바이브를 읽는 중
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
};
