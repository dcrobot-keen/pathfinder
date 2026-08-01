package graph

import (
	"encoding/json"
	"fmt"
	"math"
)

// Feature/FeatureCollection mirror the small subset of GeoJSON produced by
// src/editLayer.js (ol/format/GeoJSON output): Point / LineString / Polygon
// geometries with a "kind" property of "node" / "link" / "block".
type Geometry struct {
	Type        string          `json:"type"`
	Coordinates json.RawMessage `json:"coordinates"`
}

type Feature struct {
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties"`
	Geometry   Geometry               `json:"geometry"`
}

type FeatureCollection struct {
	Type     string    `json:"type"`
	Features []Feature `json:"features"`
}

func (g Geometry) point() (Point, error) {
	var xy [2]float64
	if err := json.Unmarshal(g.Coordinates, &xy); err != nil {
		return Point{}, err
	}
	return Point{X: xy[0], Y: xy[1]}, nil
}

func (g Geometry) lineString() ([]Point, error) {
	var coords [][2]float64
	if err := json.Unmarshal(g.Coordinates, &coords); err != nil {
		return nil, err
	}
	pts := make([]Point, len(coords))
	for i, c := range coords {
		pts[i] = Point{X: c[0], Y: c[1]}
	}
	return pts, nil
}

// polygon returns every ring of a Polygon geometry (ring[0] is the outer
// boundary; any further rings are holes, which the editor never produces
// today but are parsed for completeness).
func (g Geometry) polygon() ([][]Point, error) {
	var rings [][][2]float64
	if err := json.Unmarshal(g.Coordinates, &rings); err != nil {
		return nil, err
	}
	result := make([][]Point, len(rings))
	for i, ring := range rings {
		pts := make([]Point, len(ring))
		for j, c := range ring {
			pts[j] = Point{X: c[0], Y: c[1]}
		}
		result[i] = pts
	}
	return result, nil
}

// ExtractBlocks returns the outer ring of every Polygon ("block") feature —
// the obstacle-avoidance mode's input, independent of the node/link graph.
func ExtractBlocks(fc *FeatureCollection) ([][]Point, error) {
	var blocks [][]Point
	for i, f := range fc.Features {
		if f.Geometry.Type != "Polygon" {
			continue
		}
		rings, err := f.Geometry.polygon()
		if err != nil {
			return nil, fmt.Errorf("feature %d: %w", i, err)
		}
		if len(rings) == 0 {
			continue
		}
		blocks = append(blocks, rings[0])
	}
	return blocks, nil
}

func findNearestNode(g *Graph, p Point, epsilon float64) (string, bool) {
	bestID := ""
	bestDist := math.MaxFloat64
	for id, np := range g.Nodes {
		if d := np.distanceTo(p); d < bestDist {
			bestDist = d
			bestID = id
		}
	}
	if bestID != "" && bestDist <= epsilon {
		return bestID, true
	}
	return "", false
}

// BuildGraph converts the drawn node/link features into a searchable graph.
// Polygon ("block") features are ignored here — they matter only to the
// obstacle-avoidance mode (see the grid package).
//
// A LineString can pass through more than two existing node points (the
// editor's snapping lets you draw one link through several waypoints). Any
// interior vertex that coincides with an existing node is treated as a
// junction and splits the polyline into separate edges there — otherwise
// those in-between nodes would be stranded with no edges at all, and
// routes that should branch off a shared corridor would have no path.
func BuildGraph(fc *FeatureCollection) (*Graph, error) {
	g := NewGraph()

	for i, f := range fc.Features {
		if f.Geometry.Type != "Point" {
			continue
		}
		p, err := f.Geometry.point()
		if err != nil {
			return nil, fmt.Errorf("feature %d: %w", i, err)
		}
		g.AddNode(fmt.Sprintf("node-%d", i), p)
	}

	for i, f := range fc.Features {
		if f.Geometry.Type != "LineString" {
			continue
		}
		pts, err := f.Geometry.lineString()
		if err != nil {
			return nil, fmt.Errorf("feature %d: %w", i, err)
		}
		if len(pts) < 2 {
			continue
		}

		segStartID, ok := findNearestNode(g, pts[0], NodeSnapEpsilon)
		if !ok {
			segStartID = fmt.Sprintf("link-%d-start", i)
			g.AddNode(segStartID, pts[0])
		}

		segStart := 0
		edgeSeq := 0
		for j := 1; j < len(pts); j++ {
			isLast := j == len(pts)-1
			nodeID, matched := findNearestNode(g, pts[j], NodeSnapEpsilon)
			if !matched {
				if !isLast {
					continue // interior shape point, not a junction — keep accumulating
				}
				nodeID = fmt.Sprintf("link-%d-end", i)
				g.AddNode(nodeID, pts[j])
			}

			g.AddEdge(fmt.Sprintf("edge-%d-%d", i, edgeSeq), segStartID, nodeID, pts[segStart:j+1])
			edgeSeq++
			segStart = j
			segStartID = nodeID
		}
	}

	return g, nil
}
