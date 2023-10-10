import * as d3 from 'd3';

import TimeSeriesComponent from './time-series-component';
import Generator from './generators';
import GENERATOR_DEFAULTS from "./generator-defaults";
import Compositor, { OPERATOR, OP_CASE } from './compositor';

import datespace from '@stdlib/array/datespace';
import inmap from '@stdlib/utils/inmap';
import forEach from '@stdlib/utils/for-each';
import randi from '@stdlib/random/base/randi';
import filled from '@stdlib/array/filled'
import mapFun from '@stdlib/utils/map-function'

import { DateTime } from 'luxon';

function add(a, b) { return a+b; }
function subtract(a, b) { return a-b; }
function multiply(a, b) { return a*b; }

const TS_DEFAULTS = Object.freeze({
    samples: 100,
    dynamicRange: true,
    min: -2,
    max: 2,
    start: "2022-01-01",
    end: "2022-12-31",
})

export default class TimeSeries {

    constructor(options=TS_DEFAULTS, components=[], compositor=null) {
        this.start = options.start;
        this.end = options.end;
        this.samples = options.samples;
        this.dynamicRange = options.dynamicRange;
        this.min = options.min;
        this.max = options.max;

        this.dataX = [];
        this.dataY = [];

        this.lastUpdate = null;
        this.COMP_ID = components.length;

        this.compositor = compositor ? Compositor.fromJSON(compositor) : new Compositor();
        this.components = [];
        components.forEach(c => {
            this.components.push(TimeSeriesComponent.fromJSON(this, c))
            this.COMP_ID = Math.max(this.COMP_ID, Number.parseInt(c.id.slice(c.id.indexOf("_")+1)));
        });

        if (components.length === 0) {
            this.addComponent();
        }
    }

    toJSON(includeComponents=true, includeCompositor=true) {
        const json = {
            start: this.start,
            end: this.end,
            samples: this.samples,
            dynamicRange: this.dynamicRange,
            min: this.min,
            max: this.max,
            size: this.size,
            type: "timeseries"
        }
        if (includeComponents) {
            json.components = this.components.map(c => c.toJSON())
        }
        if (includeCompositor) {
            json.compositor = this.compositor.toJSON();
        }
        return json
    }

    toCSV() {
        if (this.dataY.length !== this.samples) {
            this.generate();
        }
        const obj = {};
        this.dataX.forEach((x, i) => {
            obj[DateTime.fromJSDate(x).toFormat("yyyy-LL-dd")] = this.dataY[i]
        });
        return [obj];
    }

    toCSVHeader() {
        if (this.dataY.length !== this.samples) {
            this.generate();
        }
        return this.dataX.map(d => DateTime.fromJSDate(d).toFormat("yyyy-LL-dd"))
    }

    fromJSON(json) {
        this.start = json.start;
        this.end = json.end;
        this.samples = json.samples;
        this.dynamicRange = json.dynamicRange;
        this.min = json.min;
        this.max = json.max;

        this.dataX = [];
        this.dataY = [];

        this.COMP_ID = json.components.length;

        this.compositor = Compositor.fromJSON(json.compositor);
        this.components = [];
        json.components.forEach(c => {
            this.components.push(TimeSeriesComponent.fromJSON(this, c))
            this.COMP_ID = Math.max(this.COMP_ID, Number.parseInt(c.id.slice(c.id.indexOf("_")+1)));
        });
        this.generate();
    }

    static fromJSON(json) {
        return new TimeSeries(json, json.components, json.compositor)
    }

    get componentIDs() {
        return this.components.map(d => d.id)
    }

    get size() {
        return this.components.length;
    }

    getID() {
        return "comp_" + (this.COMP_ID++)
    }
    getName(generator) {
        const count = this.components.reduce((acc, d) => acc + (d.generator.key === generator.key ? 1 : 0), 0);
        return generator.title + ` ${count}`;
    }

    hasID(id) {
        return this.getComponent(id) !== undefined;
    }

    clear() {
        this.dataX = [];
        this.dataY = [];
    }

    setOption(key, value) {
        switch (key) {
            case "min":
                this.min = value < this.max ? value : this.min;
                break;
            case "max":
                this.max = value > this.min ? value : this.max;
                break;
            case "start":
                this.start = value < this.end ? value : this.start;
                this.generate();
                break;
            case "end":
                this.end = value > this.start ? value : this.end;
                this.generate();
                break;
            case "samples":
                this.samples = Math.max(3, Math.round(value));
                this.generate();
                break;
            case "dynamicRange": {
                this.dynamicRange = value === true;
                if (!this.dynamicRange && this.size > 0) {
                    if (!this.dataY) {
                        this.generate();
                    }
                    const [min, max] = d3.extent(this.dataY);
                    this.min = min;
                    this.max = max;
                }
                break;
            }
        }
    }

    getComponent(id) {
        return this.components.find(c => c.id === id)
    }

    getComponentIndex(id) {
        return this.components.findIndex(c => c.id === id)
    }

    randomSeed() {
        this.components.forEach(c => c.setSeed(randi()));
        this.generate();
    }

    addComponent(generatorType) {
        if (generatorType && (generatorType in GENERATOR_DEFAULTS)) {
            const generator = new Generator(generatorType, randi());
            this.components.push(new TimeSeriesComponent(this, generator))
        } else {
            this.components.push(new TimeSeriesComponent(this))
        }
        this.compositor.addData(
            this.components[this.components.length-1].id,
            this.components[this.components.length-1].name,
            this.components[this.components.length-1].generator.type
        );
        this.generate();
    }

    removeComponent(id) {
        const idx = this.componentIDs.indexOf(id);
        if (idx >= 0) {
            this.components.splice(idx, 1)
            this.compositor.remove(id);
        }
        this.generate();
    }

    switchComponents(fromID, toID) {
        const fromIndex = this.getComponentIndex(fromID);
        const toIndex = this.getComponentIndex(toID);
        if (fromIndex >= 0 && fromIndex <= this.components.length &&
            toIndex >= 0 && toIndex <= this.components.length &&
            fromIndex !== toIndex
        ) {
            const from = this.components[fromIndex];
            this.components[fromIndex] = this.components[toIndex];
            this.components[toIndex] = from;

            this.compositor.switchData(fromID, toID);
        }
        this.generate();
    }

    generate() {

        let leftVals, rightVals, cacheVals;
        const values = filled(0, this.samples);

        const getComp = id => {
            const c = this.getComponent(id);
            if (c.data.length !== this.samples) {
                c.generate(this.samples)
            }
            return c;
        }

        const apply = (op, inplace=true) => {
            switch(op.name) {
                default:
                case OPERATOR.ADD:
                    if (inplace) {
                        inmap(values, (_, i) => add(leftVals[i], rightVals[i]));
                    } else {
                        return mapFun(i => add(leftVals[i], rightVals[i]), this.samples);
                    }
                    break;
                case OPERATOR.MULTIPLY:
                    if (inplace) {
                        inmap(values, (_, i) => multiply(leftVals[i], rightVals[i]));
                    } else {
                        return mapFun(i => multiply(leftVals[i], rightVals[i]), this.samples);
                    }
                    break;
                case OPERATOR.SUBTRACT:
                    if (inplace) {
                        inmap(values, (_, i) => subtract(leftVals[i], rightVals[i]));
                    } else {
                        return mapFun(i => subtract(leftVals[i], rightVals[i]), this.samples);
                    }
                    break;
            }
        }

        this.compositor.iterate((opCase, left, op, right, extraOp) => {

            const hasLeft = left !== undefined && left !== null;
            const hasOp = op !== undefined && op !== null;
            const hasRight = right !== undefined && right !== null;
            const hasExtraOp = extraOp !== undefined && extraOp !== null;


            switch(opCase) {
                case OP_CASE.APPLY_BOTH: {
                    console.assert(hasLeft && hasOp && hasRight, "wrong case - missing data");
                    const cl = getComp(left.id);
                    const cr = getComp(right.id);
                    leftVals = cl.data;
                    rightVals = cr.data;
                    break;
                }
                case OP_CASE.APPLY_LEFT: {
                    console.assert(hasLeft, "wrong case - missing left");
                    const c = getComp(left.id);
                    leftVals = c.data;
                    rightVals = values;
                    break;
                }
                case OP_CASE.APPLY_RIGHT: {
                    console.assert(hasRight, "wrong case - missing right");
                    const c = getComp(right.id);
                    leftVals = values;
                    rightVals = c.data;
                    break;
                }
                case OP_CASE.APPLY_NESTED_LEFT: {
                    console.assert(hasLeft && hasOp && hasRight, "wrong case - missing data");
                    const cl = getComp(left.id);
                    const cr = getComp(right.id);
                    leftVals = cl.data;
                    rightVals = cr.data;
                    break;
                }
            }

            if (hasOp) {
                cacheVals = apply(op, !hasExtraOp);
            }

            if (hasExtraOp && cacheVals) {

                switch(opCase) {
                    case OP_CASE.APPLY_NESTED_LEFT: {
                        const c = getComp(left.id);
                        leftVals = c.data;
                        rightVals = cacheVals;
                        break;
                    }
                    case OP_CASE.APPLY_NESTED_RIGHT: {
                        const c = getComp(right.id);
                        leftVals = cacheVals;
                        rightVals = c.data;
                        break;
                    }
                    default: break;
                }
                apply(extraOp);
            }

        });

        this.dataX = datespace(this.start, this.end, this.samples);
        this.dataY = values;
        this.lastUpdate = Date.now();

        return this.dataY;
    }

    toChartData() {
        const data = [];
        if (this.dataY.length !== this.samples) {
            this.generate();
        }

        this.components.forEach(c => {
            const result = [];
            forEach(c.data, (d, i) => result.push([this.dataX[i], d ]));
            data.push({
                id: c.id,
                color: c.generator.type,
                opacity: 0.25,
                values: result
            });
        });

        const result = [];
        forEach(this.dataY, (d, i) => result.push([this.dataX[i], d]));
        data.push({
            id: "result",
            color: "result",
            opacity: 1,
            values: result
        });

        return data;
    }
}