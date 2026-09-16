# MeasureCraft v1.7 — Simple/Pro BOQ Quantity Parity

## Problem fixed
The same drawing and calibration could produce slightly different material quantities in Simple Mode and Professional Mode because each mode had separate deduction/quantity logic. Typical drift included cement, sand and brick counts.

## Final fix
Simple and Professional Mode now call one shared browser calculator:

`public/js/modules/boq-parity.js`

The canonical calculator uses the same:
- calibrated drawing scale
- accepted-element rules
- wall length/height/thickness rules
- opening and column wall deductions
- slab cutout/structural footprint deductions
- floor finish and skirting rule
- concrete/material yield rules
- masonry rates
- tile/adhesive and paint rules

Both BOQ exports therefore receive the same numeric quantity for the same element dataset.

The legacy mode-specific calculators are left in place as fallback/readable code, but the normal UI/export path uses the shared calculator.

## Cache fix
Both HTML pages now load versioned script URLs with `v=1.7.0`, so browsers are forced to fetch the corrected calculator instead of reusing stale JavaScript.

## Verification
Run:

`npm run check`

and:

`npm run test-boq-parity`

After deployment, open the same project in Simple and Pro and export both BOQs. The material quantity cells should match exactly (subject only to display formatting).
