// Command server exposes the graph and grid pathfinding packages over
// HTTP so the browser UI (src/) can request routes without embedding a
// WASM build of the algorithms. Run via `go run ./server` (also wired
// into `npm run dev`, see package.json).
package main

import (
	"fmt"
	"encoding/json"
	"log"
	"math"
	"net/http"

	"pathfinder/graph"
	"pathfinder/grid"
)

type pointDTO struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func (p pointDTO) toPoint() graph.Point { return graph.Point{X: p.X, Y: p.Y} }

type nodeLinkRequest struct {
	FeatureCollection graph.FeatureCollection `json:"featureCollection"`
	Start             pointDTO                `json:"start"`
	End               pointDTO                `json:"end"`
	Algorithm         string                  `json:"algorithm"` // "dijkstra" | "astar"
}

type obstacleRequest struct {
	FeatureCollection graph.FeatureCollection `json:"featureCollection"`
	Start             pointDTO                `json:"start"`
	End               pointDTO                `json:"end"`
	Algorithm         string                  `json:"algorithm"` // "gridastar" | "hybridastar"
	CellSize          float64                 `json:"cellSize"`
	// InflationM: robot body radius + safety margin (m). Obstacles are grown by
	// this much before planning so the path keeps clearance from walls; the
	// start cell is carved back out (the robot is physically there). 0 = off.
	InflationM float64 `json:"inflationM"`
}

type pathResponse struct {
	Path      [][2]float64 `json:"path"`
	Distance  float64      `json:"distance"`
	Algorithm string       `json:"algorithm"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func pointsToCoords(pts []graph.Point) [][2]float64 {
	out := make([][2]float64, len(pts))
	for i, p := range pts {
		out[i] = [2]float64{p.X, p.Y}
	}
	return out
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorResponse{Error: message})
}

// handleNodeLinkPath implements path-finding.md mode 1: search restricted
// to the drawn node/link graph. Start/end are arbitrary click points that
// get snapped onto the nearest node or link (splitting the link into a
// virtual node) before searching, exactly like clicking on the map.
func handleNodeLinkPath(w http.ResponseWriter, r *http.Request) {
	var req nodeLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	g, err := graph.BuildGraph(&req.FeatureCollection)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	algo := graph.Algorithm(req.Algorithm)
	if algo != graph.AStar {
		algo = graph.Dijkstra
	}

	startSnap, err := graph.SnapToGraph(g, req.Start.toPoint())
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "start: "+err.Error())
		return
	}
	startID, err := g.InsertVirtualNode(startSnap, "start-click")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// snap end AFTER inserting the start node — inserting can split the
	// very edge the end point would otherwise have snapped onto.
	endSnap, err := graph.SnapToGraph(g, req.End.toPoint())
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "end: "+err.Error())
		return
	}
	endID, err := g.InsertVirtualNode(endSnap, "end-click")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	result, err := graph.ShortestPath(g, startID, endID, algo)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, pathResponse{
		Path:      pointsToCoords(result.Path),
		Distance:  result.Distance,
		Algorithm: string(algo),
	})
}

func blockBoundsPoints(blocks [][]graph.Point) []graph.Point {
	var pts []graph.Point
	for _, ring := range blocks {
		pts = append(pts, ring...)
	}
	return pts
}

// localSearchBounds는 격자를 start/end 주변 지역 범위로만 한정한다. 부지가
// 아무리 커도(200x400m 등) start/end가 가까우면 격자도 작게 유지된다 —
// 예전엔 업로드된 모든 장애물 좌표까지 bounds에 넣어서, 부지 반대편에 있는
// 상관없는 장애물 때문에 격자가 부지 전체 크기로 커지는 문제가 있었다.
func localSearchBounds(start, end graph.Point, minPadding float64) (minX, minY, maxX, maxY float64) {
	minX = math.Min(start.X, end.X)
	minY = math.Min(start.Y, end.Y)
	maxX = math.Max(start.X, end.X)
	maxY = math.Max(start.Y, end.Y)

	dist := math.Hypot(end.X-start.X, end.Y-start.Y)
	padding := math.Max(minPadding, dist*0.6) // 우회로를 낼 여유
	return minX - padding, minY - padding, maxX + padding, maxY + padding
}

func ringBounds(ring []graph.Point) (minX, minY, maxX, maxY float64) {
	minX, minY = math.Inf(1), math.Inf(1)
	maxX, maxY = math.Inf(-1), math.Inf(-1)
	for _, p := range ring {
		minX = math.Min(minX, p.X)
		minY = math.Min(minY, p.Y)
		maxX = math.Max(maxX, p.X)
		maxY = math.Max(maxY, p.Y)
	}
	return
}

func ringOverlapsBounds(ring []graph.Point, minX, minY, maxX, maxY float64) bool {
	bMinX, bMinY, bMaxX, bMaxY := ringBounds(ring)
	return !(bMaxX < minX || bMinX > maxX || bMaxY < minY || bMinY > maxY)
}

// filterRelevantBlocks는 검색 범위와 겹치는 장애물만 남긴다. 부지 반대편의
// 장애물을 걸러내면 (1) 격자 크기 자체가 커지지 않고 (2) 래스터화 비용
// (칸 수 x 장애물 수)도 크게 줄어든다.
func filterRelevantBlocks(blocks [][]graph.Point, minX, minY, maxX, maxY float64) [][]graph.Point {
	relevant := make([][]graph.Point, 0, len(blocks))
	for _, ring := range blocks {
		if ringOverlapsBounds(ring, minX, minY, maxX, maxY) {
			relevant = append(relevant, ring)
		}
	}
	return relevant
}

// maxGridCells는 격자 칸 수의 상한이다. start/end가 아주 멀리 떨어져 있으면
// localSearchBounds의 padding만으로도 격자가 커질 수 있으니, 이 상한을
// 넘어서면 cellSize를 늘려(해상도를 낮춰) 계산량을 안전하게 유지한다.
const maxGridCells = 400_000

func adaptiveCellSize(width, height, cellSize float64) float64 {
	cols := width/cellSize + 1
	rows := height/cellSize + 1
	if cols*rows <= maxGridCells {
		return cellSize
	}
	scale := math.Sqrt((cols * rows) / maxGridCells)
	return cellSize * scale
}

// handleObstaclePath implements path-finding.md mode 2: ignore the
// node/link graph entirely and search free space around drawn block
// polygons via a rasterized occupancy grid.
func handleObstaclePath(w http.ResponseWriter, r *http.Request) {
	var req obstacleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	blocks, err := graph.ExtractBlocks(&req.FeatureCollection)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	cellSize := req.CellSize
	if cellSize <= 0 {
		cellSize = 0.2
	}
	start := req.Start.toPoint()
	end := req.End.toPoint()

	searchMinX, searchMinY, searchMaxX, searchMaxY := localSearchBounds(start, end, 5.0)
	relevantBlocks := filterRelevantBlocks(blocks, searchMinX, searchMinY, searchMaxX, searchMaxY)
	cellSize = adaptiveCellSize(searchMaxX-searchMinX, searchMaxY-searchMinY, cellSize)

	boundsInput := append(blockBoundsPoints(relevantBlocks), start, end)
	originX, originY, cols, rows := grid.Bounds(boundsInput, 1.0, cellSize)
	occupancy := grid.NewGrid(originX, originY, cellSize, cols, rows)
	occupancy.RasterizeBlocks(relevantBlocks)
	if req.InflationM > 0 {
		occupancy.Inflate(req.InflationM)
		occupancy.ClearDisc(start, req.InflationM)
		if occupancy.IsOccupiedPoint(end) {
			writeError(w, http.StatusUnprocessableEntity,
				fmt.Sprintf("goal is within %.2f m of an obstacle (robot clearance); pick a point further from walls", req.InflationM))
			return
		}
	}

	algo := req.Algorithm
	var path []graph.Point
	var distance float64

	switch algo {
	case "hybridastar":
		res, err := grid.HybridAStar(occupancy, start, end)
		if err != nil {
			writeError(w, http.StatusUnprocessableEntity, err.Error())
			return
		}
		path, distance = res.Path, res.Distance
	default:
		algo = "gridastar"
		res, err := grid.GridAStar(occupancy, start, end)
		if err != nil {
			writeError(w, http.StatusUnprocessableEntity, err.Error())
			return
		}
		path, distance = res.Path, res.Distance
	}

	writeJSON(w, http.StatusOK, pathResponse{
		Path:      pointsToCoords(path),
		Distance:  distance,
		Algorithm: algo,
	})
}

func withPost(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "POST only")
			return
		}
		handler(w, r)
	}
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/path/nodelink", withPost(handleNodeLinkPath))
	mux.HandleFunc("/api/path/obstacle", withPost(handleObstaclePath))

	addr := ":3002"
	log.Printf("pathfinder API 서버 실행 중: http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
