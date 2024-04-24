import * as d3 from 'd3';
import TimeSeries from "@/use/time-series.js";
import datespace from '@stdlib/array/datespace';

import { DateTime } from 'luxon';

const TSC_DEFAULTS = Object.freeze({
    samples: 100,
    dynamicRange: true,
    min: -2,
    max: 2,
    start: "2022-01-01",
    end: "2022-03-31",
})

class TimeSeriesCollection {

    constructor(options=TSC_DEFAULTS, series=[]) {
        this.start = options.start;
        this.end = options.end;
        this.samples = options.samples;
        this.dynamicRange = options.dynamicRange;
        this.min = options.min;
        this.max = options.max;

        this.dataX = [];
        this.series = [];
        this.lastUpdate = null;

        this.TS_ID = series.length;
        series.forEach(s => {
            this.series._tsc = this;
            this.TS_ID = Math.max(this.TS_ID, Number.parseInt(s.id.slice(s.id.indexOf("_")+1))+1);
        })

        if (this.size > 0) {
            this.generate();
        }
    }

    static fromJSON(json) {
        return new TimeSeriesCollection(
            json.options,
            json.series.map(s => TimeSeries.fromJSON(null, s))
        );
    }

    fromJSON(json) {
        this.start = json.options.start;
        this.end = json.options.end;
        this.samples = json.options.samples;
        this.dynamicRange = json.options.dynamicRange;
        this.min = json.options.min;
        this.max = json.options.max;

        this.dataX = [];
        this.series = [];

        this.TS_ID = json.series.length;
        json.series.forEach(s => {
            this.series.push(TimeSeries.fromJSON(this, s))
            this.TS_ID = Math.max(this.TS_ID, Number.parseInt(s.id.slice(s.id.indexOf("_")+1))+1);
        });

        this.generate();
    }

    toJSON() {
        return {
            type: "timeseries-collection",
            options: this.options,
            series: this.series.map(s => s.toJSON())
        }
    }

    toCSV() {
        if (this.dataX.length !== this.samples) {
            this.generate();
        }
        let data = [];
        this.series.forEach(s => { data = data.concat(s.toCSV()) })
        return data;
    }

    toCSVHeader(format) {
        if (this.dataX.length !== this.samples) {
            this.generate();
        }
        return this.dataX.map(d => {
            if (format === "milliseconds") {
                return d.valueOf();
            }
            return DateTime.fromJSDate(d).toLocaleString(format)
        })
    }

    get size() {
        return this.series.length;
    }

    get options() {
        return {
            start: this.start,
            end: this.end,
            samples: this.samples,
            dynamicRange: this.dynamicRange,
            min: this.min,
            max: this.max
        }
    }

    setOption(key, value) {
        switch (key) {
            case "min":
                this.min = value < this.max ? value : this.min;
                break;
            case "max":
                this.max = value >= this.min ? value : this.max;
                break;
            case "start":
                this.start = value < this.end ? value : this.start;
                this.generate(true);
                break;
            case "end":
                this.end = value > this.start ? value : this.end;
                this.generate(true);
                break;
            case "samples":
                this.samples = Math.max(3, Math.round(value));
                this.generate(true);
                break;
            case "dynamicRange": {
                this.dynamicRange = value === true;
                if (!this.dynamicRange && this.size > 0) {
                    if (this.dataX.length !== this.samples) {
                        this.generate();
                    }
                    this.series.forEach(s => {
                        const [min, max] = d3.extent(s.dataY);
                        this.min = Math.max(min, this.min);
                        this.max = Math.min(max, this.max);
                    })
                }
                break;
            }
        }
    }

    getID() {
        return "ts_" + (this.TS_ID++)
    }

    getName(number) {
        return "timeseries " + number;
    }

    hasTimeSeries(id) {
        return this.getTimeSeries(id) !== undefined;
    }

    getTimeSeries(id) {
        return this.series.find(ts => ts.id === id);
    }
    getTimeSeriesIndex(id) {
        return this.series.findIndex(ts => ts.id === id);
    }

    addTimeSeries(timeseries=null) {
        if (timeseries && this.hasTimeSeries(timeseries.id)) {
            const idx = this.getTimeSeriesIndex(timeseries.id);
            if (idx >= 0) {
                this.series.splice(idx, 1);
            }
        }

        this.series.push(timeseries ? timeseries : new TimeSeries(
            this,
            this.getID(),
            this.getName(this.TS_ID-1))
        );
        this.generate();
    }

    removeTimeSeries(id) {
        const idx = this.getTimeSeriesIndex(id);
        if (idx >= 0) {
            this.series.splice(idx, 1);
            this.generate();
        }
    }

    update() {
        this.lastUpdate = Date.now();
    }

    generate(force=false) {
        this.dataX = datespace(this.start, this.end, this.samples);
        this.series.forEach(ts => ts.generate(this.dataX, force));
        this.update();
    }

    toChartData(opacity=0.33) {
        if (this.dataX.length !== this.samples) {
            this.generate();
        }

        let data = [];
        this.series.forEach(ts => {
            data = data.concat(ts.toChartData(false, opacity))
        });

        return data;

    }
}

export { TimeSeriesCollection as default, TSC_DEFAULTS };