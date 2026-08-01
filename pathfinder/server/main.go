// Command server exposes the graph and grid pathfinding packages over
// HTTP so the browser UI (src/) can request routes without embedding a
// WASM build of the algorithms. Run via `go run ./server` (also wired
// into `npm run dev`, see package.json).
package main

import (
	"encoding/json"
	"log"
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

	boundsInput := append(blockBoundsPoints(blocks), start, end)
	originX, originY, cols, rows := grid.Bounds(boundsInput, 1.0, cellSize)
	occupancy := grid.NewGrid(originX, originY, cellSize, cols, rows)
	occupancy.RasterizeBlocks(blocks)

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
