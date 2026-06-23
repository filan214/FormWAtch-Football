import { ImageResponse } from "next/og";

import { OG_BG, OG_BORDER, OG_FG, OG_MUTED, OG_PRIMARY, OG_SIZE } from "@/lib/og";

export const alt =
  "FormWatch — Bayesian anomaly detection for Premier League player form";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: OG_BG,
          color: OG_FG,
          position: "relative",
        }}
      >
        {/* faint pitch centre circle */}
        <div
          style={{
            position: "absolute",
            top: -150,
            right: -130,
            width: 460,
            height: 460,
            borderRadius: 460,
            border: `2px solid ${OG_BORDER}`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 60,
            right: 90,
            width: 40,
            height: 40,
            borderRadius: 40,
            border: `2px solid ${OG_BORDER}`,
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 30,
            letterSpacing: 6,
            color: OG_MUTED,
            textTransform: "uppercase",
          }}
        >
          English Premier League · weekly
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 130, letterSpacing: -2 }}>Form</span>
            <span
              style={{
                width: 26,
                height: 96,
                background: OG_PRIMARY,
                marginLeft: 14,
                marginRight: 14,
                display: "flex",
              }}
            />
            <span style={{ fontSize: 130, letterSpacing: -2, color: OG_MUTED }}>
              Watch
            </span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 40,
              marginTop: 16,
              color: OG_FG,
              maxWidth: 940,
              lineHeight: 1.25,
            }}
          >
            Player form, audited weekly — breakouts, slumps and role changes
            separated from noise.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 28,
            letterSpacing: 3,
            color: OG_MUTED,
            textTransform: "uppercase",
          }}
        >
          <span style={{ display: "flex", color: OG_PRIMARY }}>
            Gamma-Poisson
          </span>
          <span style={{ display: "flex", marginLeft: 12, marginRight: 12 }}>
            ·
          </span>
          <span style={{ display: "flex" }}>FDR-gated</span>
          <span style={{ display: "flex", marginLeft: 12, marginRight: 12 }}>
            ·
          </span>
          <span style={{ display: "flex" }}>AI-explained</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
