//go:build js && wasm

// Command wasm compiles pathfinder's grid package (GridAStar / HybridAStar)
// to WebAssembly so a browser can call the exact same, already-tested
// pathfinding code that pathfinder/server exposes over HTTP, without a
// server round-trip. Built with:
//
//	GOOS=js GOARCH=wasm go build -o pathfinder.wasm ./wasm
//
// (see ../scripts/build-wasm.mjs, which also copies the matching
// wasm_exec.js glue script from $(go env GOROOT)).
//
// This does not reimplement anything -- it's a thin syscall/js adapter over
// the real grid package, so grid's own test suite is what actually proves
// the pathfinding logic correct. This file only has to prove the request/
// response marshaling is right.
//
// First consumer: ros-chromium/robot-os-chromium's PlannerNode (see
// robot-project/doc/architecture-improvements.md and
// ros-chromium/roadmap.md Phase 7 -- it needs exactly this: grid A* over a
// locally-built occupancy grid, without installing a pathfinder server
// alongside the robot).
package main

import (
	"syscall/js"

	"pathfinder/grid"
)

func toPoints(v js.Value) []grid.Point {
	n := v.Length()
	pts := make([]grid.Point, n)
	for i := 0; i < n; i++ {
		coord := v.Index(i)
		pts[i] = grid.Point{X: coord.Index(0).Float(), Y: coord.Index(1).Float()}
	}
	return pts
}

func toBlocks(v js.Value) [][]grid.Point {
	n := v.Length()
	blocks := make([][]grid.Point, n)
	for i := 0; i < n; i++ {
		blocks[i] = toPoints(v.Index(i))
	}
	return blocks
}

// toOccupied reads a JS array-like of booleans (or 0/1 numbers -- a
// Uint8Array indexes as numbers, not booleans) into a Go []bool.
func toOccupied(v js.Value) []bool {
	n := v.Length()
	occupied := make([]bool, n)
	for i := 0; i < n; i++ {
		item := v.Index(i)
		if item.Type() == js.TypeBoolean {
			occupied[i] = item.Bool()
		} else {
			occupied[i] = item.Int() != 0
		}
	}
	return occupied
}

func pathToJS(path []grid.Point) js.Value {
	arr := js.Global().Get("Array").New(len(path))
	for i, p := range path {
		pair := js.Global().Get("Array").New(2)
		pair.SetIndex(0, p.X)
		pair.SetIndex(1, p.Y)
		arr.SetIndex(i, pair)
	}
	return arr
}

func errResult(err error) js.Value {
	result := js.Global().Get("Object").New()
	result.Set("error", err.Error())
	return result
}

func okResult(path []grid.Point, distance float64) js.Value {
	out := js.Global().Get("Object").New()
	out.Set("path", pathToJS(path))
	out.Set("distance", distance)
	return out
}

// findPath(request) -> { path: [[x,y],...], distance } | { error }
//
// request: {
//   originX, originY, cellSize, cols, rows,
//   occupied?: (bool[]|Uint8Array),   // row-major, length cols*rows -- takes priority if present
//   blocks?: [[[x,y],...],...],       // GeoJSON-style polygon rings, rasterized if occupied is absent
//   start: {x,y}, goal: {x,y},
//   algorithm: "gridastar" | "hybridastar",
// }
//
// Exactly one of occupied/blocks should be given; occupied wins if both are.
func findPath(this js.Value, args []js.Value) any {
	req := args[0]

	originX := req.Get("originX").Float()
	originY := req.Get("originY").Float()
	cellSize := req.Get("cellSize").Float()
	cols := req.Get("cols").Int()
	rows := req.Get("rows").Int()
	start := grid.Point{X: req.Get("start").Get("x").Float(), Y: req.Get("start").Get("y").Float()}
	goal := grid.Point{X: req.Get("goal").Get("x").Float(), Y: req.Get("goal").Get("y").Float()}
	algorithm := req.Get("algorithm").String()

	var g *grid.Grid
	if occupiedVal := req.Get("occupied"); !occupiedVal.IsUndefined() {
		var err error
		g, err = grid.NewGridFromOccupancy(originX, originY, cellSize, cols, rows, toOccupied(occupiedVal))
		if err != nil {
			return errResult(err)
		}
	} else {
		g = grid.NewGrid(originX, originY, cellSize, cols, rows)
		if blocksVal := req.Get("blocks"); !blocksVal.IsUndefined() {
			g.RasterizeBlocks(toBlocks(blocksVal))
		}
	}

	if algorithm == "hybridastar" {
		result, err := grid.HybridAStar(g, start, goal)
		if err != nil {
			return errResult(err)
		}
		return okResult(result.Path, result.Distance)
	}

	result, err := grid.GridAStar(g, start, goal)
	if err != nil {
		return errResult(err)
	}
	return okResult(result.Path, result.Distance)
}

func main() {
	js.Global().Set("pathfinderFindPath", js.FuncOf(findPath))
	// Signal readiness explicitly rather than making callers guess with a
	// fixed delay -- js.FuncOf registration above is synchronous, but the JS
	// side has no other way to know main() has reached this point.
	if ready := js.Global().Get("__pathfinderWasmReady"); ready.Type() == js.TypeFunction {
		ready.Invoke()
	}
	select {} // keep the Go runtime alive so pathfinderFindPath stays callable
}
