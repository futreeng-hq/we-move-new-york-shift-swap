import { ImageResponse } from "next/og";

// Unfurl card for the site root.
//
// app/s/[id]/opengraph-image.tsx already did this for individual swap links,
// but the root page had no Open Graph tags at all — so the link an operator
// actually texts to a coworker ("check this out: wmnyshiftswap.com") rendered
// as a bare URL with no preview. For an invite-only app that spreads by word
// of mouth inside a depot, that link IS the growth channel.
//
// Static by design: no database read, nothing user-specific, and nothing that
// could leak a swap or a name into a card that gets forwarded around. Same
// palette and framing as the per-swap card so the two read as one brand.

export const alt = "WMNY Shift Swap — peer-to-peer shift swaps for NYC MTA bus operators";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TRANSIT_BLACK = "#0D0D0D";
const WMNY_GOLD = "#C9A84C";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: TRANSIT_BLACK,
          padding: 72,
          justifyContent: "space-between",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 30,
            fontWeight: 800,
            color: WMNY_GOLD,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          WMNY Shift Swap
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Satori (what next/og renders with) is not a browser. Any element
              with more than one child MUST carry an explicit display value, and
              a <br /> counts as a child: text + <br /> + text is three children.
              Without it the build does not warn — it fails the prerender of
              /opengraph-image and takes the whole `next build` down with it.
              So the two lines are two flex children, not one div with a break. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 82,
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1.05,
            }}
          >
            <div>Swap shifts with</div>
            <div>operators you trust</div>
          </div>
          <div style={{ fontSize: 36, color: WMNY_GOLD, marginTop: 20, fontWeight: 600 }}>
            Built by a 32-year transit veteran
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "2px solid #2a2a2a",
            paddingTop: 28,
          }}
        >
          <div style={{ fontSize: 30, color: "#c9c9c9" }}>
            Work · Days off · Vacation
          </div>
          <div style={{ fontSize: 26, color: "#7a7a7a" }}>
            invite-only · wmnyshiftswap.com
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
