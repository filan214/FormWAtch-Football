import { ImageResponse } from "next/og";

import { fetchAnomalyCard } from "@/db/queries";
import { TYPE_META, severityTier } from "@/lib/anomaly";
import { OG_BG, OG_BORDER, OG_FG, OG_MUTED, OG_PRIMARY, OG_SIZE } from "@/lib/og";

export const alt = "FormWatch anomaly";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const card = await fetchAnomalyCard(Number(id));

  // No row (offline, or resolved off the board) → branded generic card.
  if (!card) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: 80,
            background: OG_BG,
            color: OG_FG,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 90 }}>Form</span>
            <span
              style={{
                width: 18,
                height: 66,
                background: OG_PRIMARY,
                marginLeft: 10,
                marginRight: 10,
                display: "flex",
              }}
            />
            <span style={{ fontSize: 90, color: OG_MUTED }}>Watch</span>
          </div>
          <div style={{ display: "flex", fontSize: 36, marginTop: 18, color: OG_MUTED }}>
            EPL player form anomaly detection
          </div>
        </div>
      ),
      { ...size },
    );
  }

  const meta = TYPE_META[card.anomalyType];
  const tier = severityTier(card.severity);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: OG_BG,
          color: OG_FG,
        }}
      >
        {/* type-colored spine */}
        <div style={{ width: 18, height: "100%", background: meta.color, display: "flex" }} />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 70,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 42 }}>Form</span>
              <span
                style={{
                  width: 11,
                  height: 30,
                  background: OG_PRIMARY,
                  marginLeft: 6,
                  marginRight: 6,
                  display: "flex",
                }}
              />
              <span style={{ fontSize: 42, color: OG_MUTED }}>Watch</span>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 26,
                letterSpacing: 4,
                color: OG_MUTED,
                textTransform: "uppercase",
              }}
            >
              EPL form anomaly
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                alignSelf: "flex-start",
                alignItems: "center",
                border: `2px solid ${meta.color}`,
                borderRadius: 6,
                padding: "8px 18px",
                fontSize: 28,
                letterSpacing: 3,
                color: meta.color,
                textTransform: "uppercase",
              }}
            >
              {meta.label}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: card.playerName.length > 18 ? 96 : 116,
                letterSpacing: -2,
                marginTop: 20,
                lineHeight: 1.0,
              }}
            >
              {card.playerName}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 34,
                marginTop: 16,
                color: OG_MUTED,
              }}
            >
              {[card.team, card.position].filter(Boolean).join("  ·  ") ||
                "Premier League"}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              borderTop: `1px solid ${OG_BORDER}`,
              paddingTop: 26,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 26,
                letterSpacing: 3,
                color: OG_MUTED,
                textTransform: "uppercase",
              }}
            >
              severity
            </div>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span style={{ fontSize: 150, color: tier.color, lineHeight: 1 }}>
                {card.severity}
              </span>
              <span style={{ display: "flex", fontSize: 40, color: OG_MUTED, marginLeft: 10 }}>
                /100
              </span>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
