import CellRepo, { Cell } from "./cell-repo.ts";
import { Direction, clamp, all as allDirections, Vector } from "./direction.ts";
import { NONE, ROAD, RAIL, LAKE, FOREST, EdgeType } from "./edge.ts";


export interface Score {
	exits: number[];
	center: number;
	deadends: Deadend[];
	road: Cell[];
	rail: Cell[];
	lakes: number[];
	forests: Cell[];
}

interface Deadend {
	cell: Cell;
	direction: Direction;
}

interface LongestPathContext {
	cells: CellRepo;
	edgeType: EdgeType;
	lockedCells: Set<Cell>;
}

function getNeighbor(cell: Cell, direction: Direction, cells: CellRepo) {
	let x = cell.x + Vector[direction][0];
	let y = cell.y + Vector[direction][1];
	return cells.at(x, y);
}

function getCenterCount(cells: CellRepo) {
	return cells.filter(cell => cell.center && cell.tile).length;
}

function getEdgeKey(a: Cell, b: Cell) {
	if (a.x > b.x || a.y > b.y) { [a, b] = [b, a]; }
	return [a.x, a.y, b.x, b.y].join("/");
}

function getSubgraph(start: Cell, cells: CellRepo) {
	interface QueueItem {
		cell: Cell;
		from: Direction | null;
	}

	let subgraph: Cell[] = [];
	let queue: QueueItem[] = [{cell:start, from: null}];
	let lockedEdges = new Set<string>();

	while (queue.length) {
		let current = queue.shift() as QueueItem;
		let cell = current.cell;
		if (!cell.tile) { continue; }

		subgraph.push(cell);
		let tile = cell.tile;

		let outDirections = (current.from === null ? allDirections : tile.getEdge(current.from).connects);
		outDirections.forEach(d => {
			let edgeType = tile.getEdge(d).type;
			if (edgeType == NONE) { return; }

			let neighbor = getNeighbor(cell, d, cells);
			if (!neighbor.tile) { return; }

			let neighborEdge = clamp(d+2);
			let neighborEdgeType = neighbor.tile.getEdge(neighborEdge).type;
			if (neighborEdgeType != edgeType) { return; }

			let edgeKey = getEdgeKey(cell, neighbor);
			if (lockedEdges.has(edgeKey)) { return; }

			lockedEdges.add(edgeKey);
			queue.push({cell: neighbor, from: neighborEdge});
		});
	}

	return subgraph;
}

function getConnectedExits(start: Cell, cells: CellRepo) {
	return getSubgraph(start, cells).filter(cell => cell.border);
}

function getExits(cells: CellRepo) {
	let results: number[] = [];
	let exitsArr = cells.filter(cell => cell.border && cell.tile);
	let exits = new Set(exitsArr);

	while (exits.size > 0) {
		let cell = exits.values().next().value;
		let connected = getConnectedExits(cell, cells);
		if (connected.length > 1) { results.push(connected.length); }
		connected.forEach(cell => exits.delete(cell));
	}

	return results;
}

function getLongestFrom(cell: Cell, from: Direction | null, ctx: LongestPathContext) {
	if (!cell.tile) { return []; }

	let path: Cell[] = [];

	let tile = cell.tile;
	let outDirections = (from === null ? allDirections : tile.getEdge(from).connects);

	ctx.lockedCells.add(cell);

	outDirections
		.filter(d => tile.getEdge(d).type == ctx.edgeType)
		.forEach(d => {
			let neighbor = getNeighbor(cell, d, ctx.cells);
			if (neighbor.border || !neighbor.tile) { return; }
			if (ctx.lockedCells.has(neighbor)) { return; }

			let neighborEdge = clamp(d+2);
			let neighborEdgeType = neighbor.tile.getEdge(neighborEdge).type;
			if (neighborEdgeType != ctx.edgeType) { return; }

			let subpath = getLongestFrom(neighbor, neighborEdge, ctx);
			if (subpath.length > path.length) { path = subpath; }
	});

	ctx.lockedCells.delete(cell);

	path.unshift(cell);
	return path;
}

function getLongest(edgeType: EdgeType, cells: CellRepo) {
	function contains(cell: Cell) {
		if (cell.border || !cell.tile) { return; }
		let tile = cell.tile;
		return allDirections.some(d => tile.getEdge(d).type == edgeType);
	}
	let starts = cells.filter(contains);

	let bestPath: Cell[] = [];
	starts.forEach(cell => {
		let lockedCells = new Set<Cell>();
		let ctx: LongestPathContext = { cells, edgeType, lockedCells };
		let path = getLongestFrom(cell, null, ctx);
		if (path.length > bestPath.length) { bestPath = path; }
	});

	return bestPath;
}

function isDeadend(deadend: Deadend, cells: CellRepo) {
	const cell = deadend.cell;
	const tile = cell.tile;
	if (!tile) { return false; }

	let edge = tile.getEdge(deadend.direction).type;
	if (edge != RAIL && edge != ROAD) { return false; }

	let neighbor = getNeighbor(cell, deadend.direction, cells);
	if (neighbor.border) { return false; }

	if (!neighbor.tile) { return true; }
	let neighborEdge = clamp(deadend.direction+2);
	return (neighbor.tile.getEdge(neighborEdge).type != edge);
}

function getDeadends(cells: CellRepo) {
	let deadends: Deadend[] = [];

	cells.filter(cell => !cell.border).forEach(cell => {
		allDirections.forEach(direction => {
			let deadend: Deadend = { cell, direction };
			isDeadend(deadend, cells) && deadends.push(deadend);
		});
	});

	return deadends;
}

function extractLake(lakeCells: Cell[], allCells: CellRepo) {
	let pending = [lakeCells.shift()];
	let processed: Cell[] = [];

	while (pending.length) {
		const current = pending.shift() as Cell;
		processed.push(current);

		const tile = current.tile;
		if (!tile) { continue; }

		allDirections.filter(d => tile.getEdge(d).type == LAKE).forEach(d => {
			let neighbor = getNeighbor(current, d, allCells);
			if (!neighbor.tile) { return; }

			let neighborEdge = clamp(d+2);
			let neighborEdgeType = neighbor.tile.getEdge(neighborEdge).type;
			if (neighborEdgeType != LAKE) { return; }

			let index = lakeCells.indexOf(neighbor);
			if (index == -1) { return; }
			lakeCells.splice(index, 1);
			pending.push(neighbor);
		});
	}

	return processed;
}

function getLakes(cells: CellRepo) {
	function isLake(cell: Cell) {
		if (!cell.tile) { return; }
		let tile = cell.tile;
		return allDirections.some(d => tile.getEdge(d).type == LAKE);
	}
	let lakeCells = cells.filter(isLake);

	let sizes = [];
	while (lakeCells.length) {
		sizes.push(extractLake(lakeCells, cells).length);
	}

	return sizes;
}

function getForests(cells: CellRepo) {
	function isRailRoad(cell: Cell) {
		if (cell.border || !cell.tile) { return; }
		let tile = cell.tile;
		return allDirections.every(d => tile.getEdge(d).type != FOREST);
	}

	function hasForestNeighbor(cell: Cell) {
		return allDirections.some(d => {
			let neighbor = getNeighbor(cell, d, cells);
			if (!neighbor.tile) { return; }

			let neighborEdge = clamp(d+2);
			return (neighbor.tile.getEdge(neighborEdge).type == FOREST);
		});
	}

	return cells.filter(isRailRoad).filter(hasForestNeighbor);
}

export function get(cells: CellRepo): Score {
	return {
		exits: getExits(cells),
		center: getCenterCount(cells),
		rail: getLongest(RAIL, cells),
		road: getLongest(ROAD, cells),
		deadends: getDeadends(cells),
		lakes: getLakes(cells),
		forests: getForests(cells)
	}
}

export function mapExits(score: Score) {
	return score.exits.map(count => count == 12 ? 45 : (count-1)*4);
}

export function sumLakes(score: Score) {
	return (score.lakes.length > 0 ? score.lakes.sort((a, b) => a-b)[0] : 0);
}

export function sum(score: Score) {
	let exits = mapExits(score);
	let exitScore = exits.reduce((a, b) => a+b, 0);
	let lakeScore = sumLakes(score);

	return exitScore
		+ score.road.length
		+ score.rail.length
		+ score.center
		- score.deadends.length
		+ lakeScore
		+ score.forests.length;
}
