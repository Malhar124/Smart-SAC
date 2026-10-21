import { cn } from "@/lib/utils";

/**
 * Top-down badminton court drawn to scale (1 unit = 10 cm):
 * 13.4 m x 6.1 m doubles court, singles sidelines 0.46 m in,
 * short service lines 1.98 m from the net, doubles long service lines 0.76 m from the back.
 */
const COURT_W = 61;
const COURT_L = 134;
const NET_Y = COURT_L / 2;
const SINGLES_INSET = 4.6;
const SHORT_SERVICE = 19.8;
const LONG_SERVICE_DOUBLES = 7.6;
const MARGIN = 6;

interface CourtDiagramProps {
  orientation?: "portrait" | "landscape";
  className?: string;
}

const CourtDiagram = ({ orientation = "portrait", className }: CourtDiagramProps) => {
  const portrait = orientation === "portrait";
  const viewBox = portrait
    ? `${-MARGIN} ${-MARGIN} ${COURT_W + MARGIN * 2} ${COURT_L + MARGIN * 2}`
    : `${-MARGIN} ${-MARGIN} ${COURT_L + MARGIN * 2} ${COURT_W + MARGIN * 2}`;

  return (
    <svg
      viewBox={viewBox}
      className={cn("block", className)}
      role="img"
      aria-label="Top-down drawing of a badminton court"
    >
      <g transform={portrait ? undefined : `translate(0 ${COURT_W}) rotate(-90)`}>
        <g fill="none" stroke="hsl(var(--line))" strokeWidth={0.5} strokeLinecap="square">
          <rect x={0} y={0} width={COURT_W} height={COURT_L} />
          <line x1={SINGLES_INSET} y1={0} x2={SINGLES_INSET} y2={COURT_L} />
          <line x1={COURT_W - SINGLES_INSET} y1={0} x2={COURT_W - SINGLES_INSET} y2={COURT_L} />
          <line x1={0} y1={LONG_SERVICE_DOUBLES} x2={COURT_W} y2={LONG_SERVICE_DOUBLES} />
          <line x1={0} y1={COURT_L - LONG_SERVICE_DOUBLES} x2={COURT_W} y2={COURT_L - LONG_SERVICE_DOUBLES} />
          <line x1={0} y1={NET_Y - SHORT_SERVICE} x2={COURT_W} y2={NET_Y - SHORT_SERVICE} />
          <line x1={0} y1={NET_Y + SHORT_SERVICE} x2={COURT_W} y2={NET_Y + SHORT_SERVICE} />
          <line x1={COURT_W / 2} y1={0} x2={COURT_W / 2} y2={NET_Y - SHORT_SERVICE} />
          <line x1={COURT_W / 2} y1={NET_Y + SHORT_SERVICE} x2={COURT_W / 2} y2={COURT_L} />
        </g>
        {/* Net and posts, which stand just outside the sidelines */}
        <line
          x1={-1.5}
          y1={NET_Y}
          x2={COURT_W + 1.5}
          y2={NET_Y}
          stroke="white"
          strokeOpacity={0.85}
          strokeWidth={0.6}
          strokeDasharray="1 0.8"
        />
        <circle cx={-1.5} cy={NET_Y} r={0.9} fill="white" fillOpacity={0.85} />
        <circle cx={COURT_W + 1.5} cy={NET_Y} r={0.9} fill="white" fillOpacity={0.85} />
      </g>
    </svg>
  );
};

export default CourtDiagram;
