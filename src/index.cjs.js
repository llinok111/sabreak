// CommonJS entry point.
//
// `module.exports = LineBreaker` is deliberate: the primary consumer of a line
// breaking library is CommonJS (PDFKit does `var LineBreaker = require('linebreak')`
// and calls it as a constructor), so the module object itself must be the class.
// The helpers are attached as static properties, exactly as the upstream package
// behaves.
import LineBreaker, { Break, saCapabilities, findSARuns, saBreakOpportunities } from './sabreak.js';

LineBreaker.Break = Break;
LineBreaker.saCapabilities = saCapabilities;
LineBreaker.findSARuns = findSARuns;
LineBreaker.saBreakOpportunities = saBreakOpportunities;

module.exports = LineBreaker;
