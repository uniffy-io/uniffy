---
title: Lab Sample Handling SOP
slug: vitalis-lab-sample-handling-sop
folder: Clinical Operations
tags:
  - clinical
  - lab
---

# Lab Sample Handling SOP

Controlled document. Owner: Laboratory Manager. Vitalis Lab operates under ISO 15189;
deviations from this procedure are non-conformities and are logged as such.

## Identification

Tubes are labelled at the patient's side, never in advance and never at the desk. Label
carries name, personal identification number, date and time of collection, and the
collector's initials. An unlabelled or mislabelled sample is discarded and redrawn. A
redraw is a small inconvenience; a wrong result attached to the wrong patient is not.

## Order of draw

Blood culture, citrate, serum, heparin, EDTA, fluoride. Deviating from the order causes
additive carryover and silently wrong results.

## Transport and cold chain

| Sample | Storage | Maximum time to analysis |
| --- | --- | --- |
| Routine biochemistry | 4 to 8 C | 8 hours |
| Coagulation | 18 to 24 C, upright | 4 hours |
| Blood culture | 35 to 37 C incubator | Load within 2 hours |
| Urine, unpreserved | 4 to 8 C | 2 hours |
| Genetics EDTA | 4 to 8 C | 72 hours |

Plovdiv samples travel on the 11:30 courier in a validated cool box with a temperature
logger. The logger is read on arrival and the reading is recorded. An excursion means
the affected samples are quarantined and the clinic is called before anything is
reported. Plovdiv-specific logistics are in [Plovdiv Clinic Guide](plovdiv-clinic-guide.md).

## Reception at the lab

Samples are accepted against the request, checked for volume, haemolysis and clotting,
and registered before they reach an analyser. Rejection reasons are recorded and shown
to the requesting clinic the same day.

## Reference ranges and results

Reference ranges are maintained centrally in
[lab-panel-reference-ranges.csv](file:Clinical/lab-panel-reference-ranges.csv).
Critical values are phoned
to the requesting clinician within 30 minutes of validation, and the call is logged with
the name of the person who took it. A critical value is never delivered only in writing.

## Quality control

Internal QC runs on every shift, external quality assessment quarterly. QC failures stop
reporting for the affected analyte until resolved. [Lab QA review](event:Lab QA review)
looks at rejections, turnaround times and QC breaches every Friday in
[Pirin](room:Pirin). Non-conformities that reached a patient are escalated per
[Adverse Event Reporting](adverse-event-reporting-sop.md).
