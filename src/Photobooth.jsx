import { useRef, useState, useCallback, useEffect } from "react";
import { Camera, Scissors, RefreshCw, Download, Circle, SwitchCamera } from "lucide-react";

/**
 * 
 * -----------------------------------------------------
 * Flow: pilih filter -> nyalakan webcam -> hitung mundur -> 4 jepretan
 *        -> strip foto tergabung -> download
 *
 * Cara pakai di project React kalian:
 *   import Photobooth from "./Photobooth";
 *   export default function App() { return <Photobooth />; }
 *
 * Dependencies: lucide-react
 * npm install lucide-react
 *
 * File hasil (strip 4 foto, format PNG) di-download langsung ke
 * penyimpanan device — otomatis masuk folder "Downloads" HP kalau
 * dibuka dari HP, atau folder "Downloads" laptop kalau dari laptop,
 * sesuai perilaku default browser masing-masing.
 */

const FILTERS = {
  bw: { label: "black & white", css: "grayscale(1) contrast(1.15) brightness(1.02)" },
  color: { label: "color", css: "saturate(1.15) contrast(1.05)" },
  sepia: { label: "sepia", css: "sepia(0.55) contrast(1.05) brightness(1.02)" },
};

const SHOTS_NEEDED = 4;
const COUNTDOWN_SECONDS = 3;
const STRIP_W = 360;
const OUTER_PAD = 16;
const GRID_COLS = 2;
const GRID_ROWS = 2;
const CELL_GAP = 10;
const CELL_W = Math.floor((STRIP_W - OUTER_PAD * 2 - CELL_GAP * (GRID_COLS - 1)) / GRID_COLS);
const CELL_H = Math.round(CELL_W * (4 / 3)); // matches captured photo's 3:4 portrait ratio

const FRAME_STYLES = {
  haru: { label: "Haru film" },
  cute: { label: "cute doodle" },
};

// ---- drawing helpers ----
function drawStarShape(ctx, cx, cy, outerR, innerR, points, color, rotation = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawCloudFace(ctx, cx, cy, size, color) {
  ctx.save();
  const r = size * 0.42;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx - r * 0.9, cy + r * 0.1, r * 0.65, 0, Math.PI * 2);
  ctx.arc(cx - r * 0.2, cy - r * 0.45, r * 0.8, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.55, cy - r * 0.25, r * 0.72, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.9, cy + r * 0.15, r * 0.55, 0, Math.PI * 2);
  ctx.arc(cx, cy + r * 0.35, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a3a3a";
  ctx.beginPath();
  ctx.arc(cx - r * 0.22, cy + r * 0.05, r * 0.07, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.22, cy + r * 0.05, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#3a3a3a";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.2, r * 0.16, 0, Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawPolkaBackground(ctx, w, h, bgColor, dotColor) {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);
  const spacing = 24;
  for (let yy = spacing / 2; yy < h; yy += spacing) {
    for (let xx = spacing / 2; xx < w; xx += spacing) {
      ctx.beginPath();
      ctx.arc(xx, yy, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
    }
  }
}

export default function Photobooth() {
  const [stage, setStage] = useState("choose"); // choose -> live -> review -> strip
  const [filterKey, setFilterKey] = useState("bw");
  const [shots, setShots] = useState([]); // array of dataURLs
  const [countdown, setCountdown] = useState(null);
  const [stripUrl, setStripUrl] = useState(null);
  const [error, setError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [facingMode, setFacingMode] = useState("user"); // "user" = depan, "environment" = belakang
  const [frameStyle, setFrameStyle] = useState("haru"); // haru | cute

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const shotCanvasRef = useRef(null);
  const stripCanvasRef = useRef(null);
  const timerRef = useRef(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async (mode) => {
    setError(null);
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode || facingMode },
          width: { ideal: 720 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (e) {
      setError(
        "Tidak bisa akses kamera. Pastikan izin kamera sudah diberikan ke browser."
      );
    }
  }, [facingMode, stopCamera]);

  const switchCamera = useCallback(async () => {
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    await startCamera(next);
  }, [facingMode, startCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stopCamera]);

  const goLive = async () => {
    setShots([]);
    setStripUrl(null);
    setStage("live");
    await startCamera(facingMode);
  };

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    const canvas = shotCanvasRef.current;
    const targetW = 480;
    const targetH = 640;
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");

    // cover-fit crop from video — matches what's visible in the live preview,
    // no extra zoom, so the background stays in shot
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const videoRatio = vw / vh;
    const targetRatio = targetW / targetH;
    let sw, sh;
    if (videoRatio > targetRatio) {
      sh = vh;
      sw = sh * targetRatio;
    } else {
      sw = vw;
      sh = sw / targetRatio;
    }
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;

    ctx.save();
    if (facingMode === "user") {
      // mirror like a selfie cam (front camera only)
      ctx.translate(targetW, 0);
      ctx.scale(-1, 1);
    }
    ctx.filter = FILTERS[filterKey].css;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetW, targetH);
    ctx.restore();

    return canvas.toDataURL("image/png");
  }, [filterKey, facingMode]);

  const runCountdownAndShoot = useCallback(() => {
    setCountdown(COUNTDOWN_SECONDS);
    let n = COUNTDOWN_SECONDS;
    timerRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(timerRef.current);
        setCountdown(null);
        const dataUrl = captureFrame();
        setShots((prev) => {
          const next = dataUrl ? [...prev, dataUrl] : prev;
          return next;
        });
      } else {
        setCountdown(n);
      }
    }, 1000);
  }, [captureFrame]);

  // Auto-advance through the 4 shots
  useEffect(() => {
    if (stage !== "live" || !cameraReady) return;
    if (shots.length >= SHOTS_NEEDED) {
      stopCamera();
      setStage("review");
      return;
    }
    if (countdown === null) {
      const t = setTimeout(() => runCountdownAndShoot(), 700);
      return () => clearTimeout(t);
    }
  }, [stage, cameraReady, shots.length, countdown, runCountdownAndShoot, stopCamera]);

  const buildStrip = useCallback((styleKey) => {
    const style = styleKey || frameStyle;
    const canvas = stripCanvasRef.current;

    const headerH = style === "haru" ? 78 : 14;
    const footerH = style === "haru" ? 46 : 40;
    const gridH = GRID_ROWS * CELL_H + (GRID_ROWS - 1) * CELL_GAP;
    const h = headerH + OUTER_PAD + gridH + OUTER_PAD + footerH;

    canvas.width = STRIP_W;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    const dateStr = new Date().toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    // ---- background + header per style ----
    if (style === "cute") {
      drawPolkaBackground(ctx, STRIP_W, h, "#b9aed6", "#ded9a8");
      // corner doodles
      drawStarShape(ctx, 30, 26, 12, 5, 5, "#f4e9a1", -0.2);
      drawCloudFace(ctx, STRIP_W - 34, 24, 30, "#7fae86");
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, STRIP_W, h);
      ctx.strokeStyle = "#e6e6e6";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(2, 2, STRIP_W - 4, h - 4);

      ctx.textAlign = "right";
      ctx.font = "11px Arial, sans-serif";
      ctx.fillStyle = "#8a8a8a";
      ctx.fillText(`▶ ${SHOTS_NEEDED}`, STRIP_W - OUTER_PAD, 24);

      ctx.textAlign = "center";
      ctx.font = "28px Georgia, 'Times New Roman', serif";
      ctx.fillStyle = "#1c1c1c";
      ctx.fillText("Haru film", STRIP_W / 2, 56);
    }

    const gridTop = headerH + OUTER_PAD;
    const positions = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
    ];
    const cuteAccents = ["#e0533d", "#3f8f7a", "#c98fc9", "#e0a83d"];
    const cuteCaptions = ["cute!!", "fall in love!", "wink!", "yay!"];

    const drawImg = (idx) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const { col, row } = positions[idx];
          const x = OUTER_PAD + col * (CELL_W + CELL_GAP);
          const y = gridTop + row * (CELL_H + CELL_GAP);

          ctx.save();
          ctx.fillStyle = "#111";
          ctx.fillRect(x, y, CELL_W, CELL_H);
          const ratio = Math.max(CELL_W / img.width, CELL_H / img.height);
          const dw = img.width * ratio;
          const dh = img.height * ratio;
          ctx.drawImage(img, x + (CELL_W - dw) / 2, y + (CELL_H - dh) / 2, dw, dh);
          ctx.restore();

          if (style === "cute") {
            ctx.strokeStyle = cuteAccents[idx % cuteAccents.length];
            ctx.lineWidth = 4;
            ctx.strokeRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4);
            // hand-written style caption near bottom of cell
            ctx.save();
            ctx.translate(x + CELL_W / 2, y + CELL_H - 14);
            ctx.rotate(idx % 2 === 0 ? -0.04 : 0.04);
            ctx.textAlign = "center";
            ctx.font = "italic bold 13px 'Comic Sans MS', 'Segoe Print', cursive";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(cuteCaptions[idx % cuteCaptions.length], 0, 0);
            ctx.restore();
          } else {
            ctx.strokeStyle = "#cfcfcf";
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, CELL_W, CELL_H);
          }

          resolve();
        };
        img.src = shots[idx];
      });
    };

    return (async () => {
      for (let i = 0; i < shots.length; i++) {
        await drawImg(i);
      }

      const footerY = gridTop + gridH + OUTER_PAD;
      if (style === "haru") {
        ctx.textAlign = "left";
        ctx.font = "11px Arial, sans-serif";
        ctx.fillStyle = "#8a8a8a";
        ctx.fillText("SPARK fotoboot", OUTER_PAD, footerY + 18);
        ctx.textAlign = "right";
        ctx.fillText(dateStr, STRIP_W - OUTER_PAD, footerY + 18);
      } else {
        ctx.textAlign = "center";
        ctx.font = "12px Arial, sans-serif";
        ctx.fillStyle = "#3a3550";
        ctx.fillText(dateStr, STRIP_W / 2, footerY + 16);
      }

      setStripUrl(canvas.toDataURL("image/png"));
      setStage("strip");
    })();
  }, [shots, frameStyle]);

  useEffect(() => {
    if (stage === "review" && shots.length === SHOTS_NEEDED) {
      buildStrip(frameStyle);
    }
  }, [stage, shots.length, buildStrip, frameStyle]);

  const selectFrameStyle = (key) => {
    setFrameStyle(key);
    if (shots.length === SHOTS_NEEDED) {
      buildStrip(key);
    }
  };

  const downloadStrip = () => {
    if (!stripUrl) return;
    const a = document.createElement("a");
    a.href = stripUrl;
    a.download = `fotobooth-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const startOver = () => {
    setShots([]);
    setStripUrl(null);
    setCountdown(null);
    setStage("choose");
  };

  const cancelLive = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCountdown(null);
    stopCamera();
    setShots([]);
    setStripUrl(null);
    setStage("choose");
  };

  return (
    <div
      style={{
        "--paper": "#f6f1e7",
        "--paper-edge": "#d8cfb8",
        "--ink": "#241f1a",
        "--ink-soft": "#6b6250",
        "--accent": "#b3452c",
        minHeight: "100%",
        width: "100%",
        background:
          "radial-gradient(1200px 600px at 50% -10%, #efe6d2 0%, #e7dcc2 55%, #ded1af 100%)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "32px 16px",
        fontFamily: "'Courier New', Courier, monospace",
        color: "var(--ink)",
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <header style={{ textAlign: "center", marginBottom: 22 }}>
          <div
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontStyle: "italic",
              fontSize: 30,
              letterSpacing: 0.3,
            }}
          >
            SPARK  <span style={{ color: "var(--accent)" }}>✻</span> fotoboot
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4, letterSpacing: 1 }}>
            {SHOTS_NEEDED} PHOTOS 
          </div>
        </header>

        {/* CHOOSE FILTER */}
        {stage === "choose" && (
          <div
            style={{
              background: "var(--paper)",
              border: "1.5px solid var(--paper-edge)",
              borderRadius: 4,
              padding: "28px 22px",
              boxShadow: "0 10px 30px rgba(40,30,10,0.12)",
            }}
          >
            <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 0 }}>
            Pilih filter
            </p>
            <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
              {Object.entries(FILTERS).map(([key, f]) => (
                <button
                  key={key}
                  onClick={() => setFilterKey(key)}
                  style={{
                    flex: "1 1 100px",
                    padding: "10px 8px",
                    borderRadius: 3,
                    border:
                      filterKey === key ? "2px solid var(--ink)" : "1.5px solid var(--paper-edge)",
                    background: filterKey === key ? "#fffdf7" : "transparent",
                    fontFamily: "'Courier New', Courier, monospace",
                    fontSize: 13,
                    cursor: "pointer",
                    color: "var(--ink)",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {error && (
              <p style={{ color: "var(--accent)", fontSize: 12, marginBottom: 12 }}>{error}</p>
            )}

            <button
              onClick={goLive}
              style={{
                width: "100%",
                padding: "13px 0",
                borderRadius: 3,
                border: "none",
                background: "var(--ink)",
                color: "#f6f1e7",
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: 14,
                letterSpacing: 0.5,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Camera size={16} /> nyalakan kamera
            </button>
          </div>
        )}

        {/* LIVE CAPTURE */}
        {stage === "live" && (
          <div
            style={{
              background: "#171310",
              border: "1.5px solid var(--paper-edge)",
              borderRadius: 4,
              padding: 14,
              boxShadow: "0 10px 30px rgba(40,30,10,0.18)",
            }}
          >
            <div
              style={{
                position: "relative",
                borderRadius: 3,
                overflow: "hidden",
                aspectRatio: "3 / 4",
                background: "#000",
              }}
            >
              <video
                ref={videoRef}
                muted
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: facingMode === "user" ? "scaleX(-1)" : "none",
                  filter: FILTERS[filterKey].css,
                }}
              />
              {countdown !== null && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 84,
                    fontFamily: "Georgia, serif",
                    color: "#fff",
                    textShadow: "0 2px 12px rgba(0,0,0,0.6)",
                  }}
                >
                  {countdown}
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  top: 10,
                  left: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(0,0,0,0.45)",
                  padding: "4px 8px",
                  borderRadius: 20,
                  fontSize: 11,
                  color: "#fff",
                }}
              >
                <Circle size={8} fill="#e0533d" color="#e0533d" />
                {shots.length}/{SHOTS_NEEDED}
              </div>
              <button
                onClick={switchCamera}
                disabled={countdown !== null}
                title="ganti kamera depan/belakang"
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  border: "none",
                  background: "rgba(0,0,0,0.45)",
                  color: "#fff",
                  cursor: countdown !== null ? "default" : "pointer",
                  opacity: countdown !== null ? 0.5 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <SwitchCamera size={17} />
              </button>
            </div>
            <p
              style={{
                textAlign: "center",
                color: "#cfc6b3",
                fontSize: 12,
                marginTop: 10,
                marginBottom: 0,
              }}
            >
              {!cameraReady
                ? "menunggu izin kamera…"
                : "Buat gaya cs"}
            </p>
            <button
              onClick={cancelLive}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "10px 0",
                borderRadius: 3,
                border: "1.5px solid #4a4238",
                background: "transparent",
                color: "#cfc6b3",
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              batal · kembali ke menu awal
            </button>
          </div>
        )}

        {/* REVIEW (building strip) */}
        {stage === "review" && (
          <div
            style={{
              textAlign: "center",
              padding: "40px 0",
              color: "var(--ink-soft)",
              fontSize: 13,
            }}
          >
            menyusun strip foto…
          </div>
        )}

        {/* STRIP RESULT */}
        {stage === "strip" && stripUrl && (
          <div style={{ textAlign: "center" }}>
            <img
              src={stripUrl}
              alt="Hasil strip foto"
              style={{
                width: "100%",
                maxWidth: 300,
                height: "auto",
                margin: "0 auto",
                display: "block",
                objectFit: "contain",
                boxShadow: "0 14px 34px rgba(40,30,10,0.22)",
                borderRadius: 2,
              }}
            />

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "center",
                marginTop: 16,
                flexWrap: "wrap",
              }}
            >
              {Object.entries(FRAME_STYLES).map(([key, s]) => (
                <button
                  key={key}
                  onClick={() => selectFrameStyle(key)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 3,
                    border:
                      frameStyle === key
                        ? "2px solid var(--ink)"
                        : "1.5px solid var(--paper-edge)",
                    background: frameStyle === key ? "#fffdf7" : "transparent",
                    fontFamily: "'Courier New', Courier, monospace",
                    fontSize: 12,
                    cursor: "pointer",
                    color: "var(--ink)",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 8, marginBottom: 0 }}>
              pilih gaya bingkai
            </p>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "center",
                marginTop: 20,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={downloadStrip}
                style={{
                  padding: "11px 18px",
                  borderRadius: 3,
                  border: "none",
                  background: "var(--ink)",
                  color: "#f6f1e7",
                  fontFamily: "'Courier New', Courier, monospace",
                  fontSize: 13,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Download size={15} /> download strip
              </button>
              <button
                onClick={startOver}
                style={{
                  padding: "11px 18px",
                  borderRadius: 3,
                  border: "1.5px solid var(--paper-edge)",
                  background: "transparent",
                  color: "var(--ink)",
                  fontFamily: "'Courier New', Courier, monospace",
                  fontSize: 13,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <RefreshCw size={14} /> ulangi
              </button>
            </div>
            <p
              style={{
                fontSize: 11,
                color: "var(--ink-soft)",
                marginTop: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Scissors size={12} /> file akan tersimpan ke folder Downloads device kalian
            </p>
          </div>
        )}
      </div>

      {/* hidden work canvases */}
      <canvas ref={shotCanvasRef} style={{ display: "none" }} />
      <canvas ref={stripCanvasRef} style={{ display: "none" }} />
    </div>
  );
}
