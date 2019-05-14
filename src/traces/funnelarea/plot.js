/**
* Copyright 2012-2019, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/

'use strict';

var d3 = require('d3');

var Fx = require('../../components/fx');
var Drawing = require('../../components/drawing');
var Lib = require('../../lib');
var svgTextUtils = require('../../lib/svg_text_utils');

var eventData = require('./event_data');

var pieHelpers = require('../pie/helpers');
var piePlot = require('../pie/plot');

var positionTitleInside = piePlot.positionTitleInsid;
var positionTitleOutside = piePlot.positionTitleOutside;

var determineInsideTextFont = piePlot.determineInsideTextFont;
var determineOutsideTextFont = piePlot.determineOutsideTextFont;

var prerenderTitles = piePlot.prerenderTitles;
var scalePies = piePlot.scalePies;

module.exports = function plot(gd, cdModule) {
    var fullLayout = gd._fullLayout;

    prerenderTitles(cdModule, gd);
    scalePies(cdModule, fullLayout._size);

    Lib.makeTraceGroups(fullLayout._funnelarealayer, cdModule, 'trace').each(function(cd) {
        var plotGroup = d3.select(this);
        var cd0 = cd[0];
        var trace = cd0.trace;

        setCoords(cd);

        // TODO: miter might look better but can sometimes cause problems
        // maybe miter with a small-ish stroke-miterlimit?
        plotGroup.attr('stroke-linejoin', 'round');

        plotGroup.each(function() {
            var slices = d3.select(this).selectAll('g.slice').data(cd);

            slices.enter().append('g')
                .classed('slice', true);
            slices.exit().remove();

            var quadrants = [
                [[], []], // y<0: x<0, x>=0
                [[], []] // y>=0: x<0, x>=0
            ];

            slices.each(function(pt) {
                if(pt.hidden) {
                    d3.select(this).selectAll('path,g').remove();
                    return;
                }

                // to have consistent event data compared to other traces
                pt.pointNumber = pt.i;
                pt.curveNumber = trace.index;

                quadrants[pt.pxmid[1] < 0 ? 0 : 1][pt.pxmid[0] < 0 ? 0 : 1].push(pt);

                var cx = cd0.cx;
                var cy = cd0.cy;
                var sliceTop = d3.select(this);
                var slicePath = sliceTop.selectAll('path.surface').data([pt]);

                slicePath.enter().append('path')
                    .classed('surface', true)
                    .style({'pointer-events': 'all'});

                sliceTop.call(attachFxHandlers, gd, cd);

                pt.cxFinal = cx;
                pt.cyFinal = cy;

                slicePath.attr('d',
                    'M' + cx + ',' + cy +
                    'l' + pt.px0[0] + ',' + pt.px0[1] +
                    'l' + (pt.px1[0] - pt.px0[0]) + ',' + (pt.px1[1] - pt.px0[1]) +
                    'Z');

                // add text
                var textPosition = pieHelpers.castOption(trace.textposition, pt.pts);
                var sliceTextGroup = sliceTop.selectAll('g.slicetext')
                    .data(pt.text && (textPosition !== 'none') ? [0] : []);

                sliceTextGroup.enter().append('g')
                    .classed('slicetext', true);
                sliceTextGroup.exit().remove();

                sliceTextGroup.each(function() {
                    var sliceText = Lib.ensureSingle(d3.select(this), 'text', '', function(s) {
                        // prohibit tex interpretation until we can handle
                        // tex and regular text together
                        s.attr('data-notex', 1);
                    });

                    sliceText.text(pt.text)
                        .attr({
                            'class': 'slicetext',
                            transform: '',
                            'text-anchor': 'middle'
                        })
                        .call(Drawing.font, textPosition === 'outside' ?
                          determineOutsideTextFont(trace, pt, gd._fullLayout.font) :
                          determineInsideTextFont(trace, pt, gd._fullLayout.font))
                        .call(svgTextUtils.convertToTspans, gd);

                    // position the text relative to the slice
                    var textBB = Drawing.bBox(sliceText.node());
                    var transform;

                    if(textPosition === 'outside') {
                        transform = transformOutsideText(textBB, pt);
                    } else {
                        transform = transformInsideText(textBB, pt, cd0);
                        if(textPosition === 'auto' && transform.scale < 1) {
                            sliceText.call(Drawing.font, trace.outsidetextfont);
                            if(trace.outsidetextfont.family !== trace.insidetextfont.family ||
                                    trace.outsidetextfont.size !== trace.insidetextfont.size) {
                                textBB = Drawing.bBox(sliceText.node());
                            }
                            transform = transformOutsideText(textBB, pt);
                        }
                    }

                    var translateX = cx + (transform.x || 0);
                    var translateY = cy + (transform.y || 0) + pt.pxmid[1] - textBB.height / 2;

                    // save some stuff to use later ensure no labels overlap
                    if(transform.outside) {
                        pt.yLabelMin = translateY - textBB.height / 2;
                        pt.yLabelMid = translateY;
                        pt.yLabelMax = translateY + textBB.height / 2;
                        pt.labelExtraX = 0;
                        pt.labelExtraY = 0;
                    }

                    sliceText.attr('transform',
                        'translate(' + translateX + ',' + translateY + ')' +
                        (transform.scale < 1 ? ('scale(' + transform.scale + ')') : '') +
                        (transform.rotate ? ('rotate(' + transform.rotate + ')') : '') +
                        'translate(' +
                            (-(textBB.left + textBB.right) / 2) + ',' +
                            (-(textBB.top + textBB.bottom) / 2) +
                        ')');
                });
            });

            // add the title
            var titleTextGroup = d3.select(this).selectAll('g.titletext')
                .data(trace.title.text ? [0] : []);

            titleTextGroup.enter().append('g')
                .classed('titletext', true);
            titleTextGroup.exit().remove();

            titleTextGroup.each(function() {
                var titleText = Lib.ensureSingle(d3.select(this), 'text', '', function(s) {
                    // prohibit tex interpretation as above
                    s.attr('data-notex', 1);
                });

                var txt = fullLayout.meta ?
                    Lib.templateString(trace.title.text, {meta: fullLayout.meta}) :
                    trace.title.text;

                titleText.text(txt)
                    .attr({
                        'class': 'titletext',
                        transform: '',
                        'text-anchor': 'middle',
                    })
                .call(Drawing.font, trace.title.font)
                .call(svgTextUtils.convertToTspans, gd);

                var transform;

                if(trace.title.position === 'middle center') {
                    transform = positionTitleInside(cd0);
                } else {
                    transform = positionTitleOutside(cd0, fullLayout._size);
                }

                titleText.attr('transform',
                    'translate(' + transform.x + ',' + transform.y + ')' +
                    (transform.scale < 1 ? ('scale(' + transform.scale + ')') : '') +
                    'translate(' + transform.tx + ',' + transform.ty + ')');
            });
        });
    });
};

function attachFxHandlers(sliceTop, gd, cd) {
    var cd0 = cd[0];
    var trace = cd0.trace;
    var cx = cd0.cx;
    var cy = cd0.cy;

    // hover state vars
    // have we drawn a hover label, so it should be cleared later
    if(!('_hasHoverLabel' in trace)) trace._hasHoverLabel = false;
    // have we emitted a hover event, so later an unhover event should be emitted
    // note that click events do not depend on this - you can still get them
    // with hovermode: false or if you were earlier dragging, then clicked
    // in the same slice that you moused up in
    if(!('_hasHoverEvent' in trace)) trace._hasHoverEvent = false;

    sliceTop.on('mouseover', function(pt) {
        // in case fullLayout or fullData has changed without a replot
        var fullLayout2 = gd._fullLayout;
        var trace2 = gd._fullData[trace.index];

        if(gd._dragging || fullLayout2.hovermode === false) return;

        var hoverinfo = trace2.hoverinfo;
        if(Array.isArray(hoverinfo)) {
            // super hacky: we need to pull out the *first* hoverinfo from
            // pt.pts, then put it back into an array in a dummy trace
            // and call castHoverinfo on that.
            // TODO: do we want to have Fx.castHoverinfo somehow handle this?
            // it already takes an array for index, for 2D, so this seems tricky.
            hoverinfo = Fx.castHoverinfo({
                hoverinfo: [pieHelpers.castOption(hoverinfo, pt.pts)],
                _module: trace._module
            }, fullLayout2, 0);
        }

        if(hoverinfo === 'all') hoverinfo = 'label+text+value+percent+name';

        // in case we dragged over the pie from another subplot,
        // or if hover is turned off
        if(trace2.hovertemplate || (hoverinfo !== 'none' && hoverinfo !== 'skip' && hoverinfo)) {
            var hoverCenterX = cx + pt.pxmid[0];
            var hoverCenterY = cy + pt.pxmid[1];
            var separators = fullLayout2.separators;
            var text = [];
            var tx;

            if(hoverinfo && hoverinfo.indexOf('label') !== -1) text.push(pt.label);

            pt.text = pieHelpers.castOption(trace2.hovertext || trace2.text, pt.pts);
            if(hoverinfo && hoverinfo.indexOf('text') !== -1) {
                tx = pt.text;
                if(Lib.isValidTextValue(tx)) text.push(tx);
            }

            pt.value = pt.v;
            pt.valueLabel = pieHelpers.formatPieValue(pt.v, separators);
            if(hoverinfo && hoverinfo.indexOf('value') !== -1) text.push(pt.valueLabel);

            var nPercent = 0;
            if(hoverinfo && hoverinfo.indexOf('percent initial') !== -1) nPercent++;
            if(hoverinfo && hoverinfo.indexOf('percent total') !== -1) nPercent++;

            var hasMultiplePercents = nPercent > 1;

            pt.percentInitial = pt.v / cd0.v;
            pt.percentInitialLabel = Lib.formatPercent(pt.percentInitial);
            if(hoverinfo && hoverinfo.indexOf('percent initial') !== -1) {
                tx = pt.percentInitialLabel;
                if(hasMultiplePercents) tx += ' of initial';
                text.push(tx);
            }

            pt.percentTotal = pt.v / cd0.vTotal;
            pt.percentTotalLabel = Lib.formatPercent(pt.percentTotal);
            if(hoverinfo && hoverinfo.indexOf('percent total') !== -1) {
                tx = pt.percentTotalLabel;
                if(hasMultiplePercents) tx += ' of total';
                text.push(tx);
            }

            var hoverLabel = trace2.hoverlabel;
            var hoverFont = hoverLabel.font;

            Fx.loneHover({
                trace: trace,
                x0: hoverCenterX - cd0.r,
                x1: hoverCenterX + cd0.r,
                y: hoverCenterY,
                text: text.join('<br>'),
                name: (trace2.hovertemplate || hoverinfo.indexOf('name') !== -1) ? trace2.name : undefined,
                idealAlign: pt.pxmid[0] < 0 ? 'left' : 'right',
                color: pieHelpers.castOption(hoverLabel.bgcolor, pt.pts) || pt.color,
                borderColor: pieHelpers.castOption(hoverLabel.bordercolor, pt.pts),
                fontFamily: pieHelpers.castOption(hoverFont.family, pt.pts),
                fontSize: pieHelpers.castOption(hoverFont.size, pt.pts),
                fontColor: pieHelpers.castOption(hoverFont.color, pt.pts),
                nameLength: pieHelpers.castOption(hoverLabel.namelength, pt.pts),
                textAlign: pieHelpers.castOption(hoverLabel.align, pt.pts),
                hovertemplate: pieHelpers.castOption(trace2.hovertemplate, pt.pts),
                hovertemplateLabels: pt,
                eventData: [eventData(pt, trace2)]
            }, {
                container: fullLayout2._hoverlayer.node(),
                outerContainer: fullLayout2._paper.node(),
                gd: gd
            });

            trace._hasHoverLabel = true;
        }

        trace._hasHoverEvent = true;
        gd.emit('plotly_hover', {
            points: [eventData(pt, trace2)],
            event: d3.event
        });
    });

    sliceTop.on('mouseout', function(evt) {
        var fullLayout2 = gd._fullLayout;
        var trace2 = gd._fullData[trace.index];
        var pt = d3.select(this).datum();

        if(trace._hasHoverEvent) {
            evt.originalEvent = d3.event;
            gd.emit('plotly_unhover', {
                points: [eventData(pt, trace2)],
                event: d3.event
            });
            trace._hasHoverEvent = false;
        }

        if(trace._hasHoverLabel) {
            Fx.loneUnhover(fullLayout2._hoverlayer.node());
            trace._hasHoverLabel = false;
        }
    });

    sliceTop.on('click', function(pt) {
        // TODO: this does not support right-click. If we want to support it, we
        // would likely need to change pie to use dragElement instead of straight
        // mapbox event binding. Or perhaps better, make a simple wrapper with the
        // right mousedown, mousemove, and mouseup handlers just for a left/right click
        // mapbox would use this too.
        var fullLayout2 = gd._fullLayout;
        var trace2 = gd._fullData[trace.index];

        if(gd._dragging || fullLayout2.hovermode === false) return;

        gd._hoverdata = [eventData(pt, trace2)];
        Fx.click(gd, d3.event);
    });
}

function transformInsideText(textBB, pt, cd0) {
    var textDiameter = Math.sqrt(textBB.width * textBB.width + textBB.height * textBB.height);
    var r = cd0.r || pt.rpx1;

    var transform = {
        scale: r * 2 / textDiameter,

        rotate: 0
    };

    return transform;
}

function transformOutsideText(textBB, pt) {
    var x = pt.pxmid[0];
    var y = pt.pxmid[1];
    var dx = textBB.width / 2;
    var dy = textBB.height / 2;

    if(x < 0) dx *= -1;
    if(y < 0) dy *= -1;

    return {
        scale: 1,

        rotate: 0,
        x: dx + Math.abs(dy) * (dx > 0 ? 1 : -1) / 2,
        y: dy / (1 + x * x / (y * y)),
        outside: true
    };
}

function setCoords(cd) {
    var sumSteps = 0;

    var cd0 = cd[0];
    var totalValues = cd0.vTotal;

    for(var i = cd.length - 1; i > -1; i--) {
        var cdi = cd[i];
        if(cdi.hidden) continue;

        var step = cdi.v / totalValues;
        sumSteps += step;

        var x, y;
        x = y = cd0.r * Math.sqrt(sumSteps);

        cdi.px0 = [-x, -y];
        cdi.px1 = [x, -y];
        cdi.pxmid = [0, -y];
    }
}
