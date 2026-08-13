import test from "node:test";
import assert from "node:assert/strict";
import { auditCandleSeries, runHistoricalVolumeReliabilityAudit } from "./volume-reliability-v1105.js";
const M=60000;
const c=(t,v=1)=>({openTime:t,closeTime:t+M-1,open:1,high:1,low:1,close:1,volume:v});
test("series audit finds duplicates gaps and zeros",()=>{const r=auditCandleSeries([c(0),c(M,0),c(M,0),c(3*M)],M,0,4*M);assert.equal(r.duplicateTimestamps,1);assert.equal(r.missingSlots,1);assert.equal(r.zeroCount,1);});
test("dominant source zeros are marked unreliable",()=>{const raw=Array.from({length:60},(_,i)=>c(i*M,i<45?0:1));const fast=Array.from({length:12},(_,i)=>({...c(i*5*M,i<9?0:5),closeTime:i*5*M+5*M-1}));const main=Array.from({length:4},(_,i)=>({...c(i*15*M,i<3?0:15),closeTime:i*15*M+15*M-1}));const r=runHistoricalVolumeReliabilityAudit({raw1m:raw,fast5m:fast,main15m:main,fromMs:0,toMs:60*M});assert.equal(r.status,"SOURCE_ZERO_VOLUME_DOMINANT");assert.equal(r.reliableForVolumeStrategyCalibration,false);});
test("timestamp gaps take precedence",()=>{const r=runHistoricalVolumeReliabilityAudit({raw1m:[c(0),c(M),c(10*M)],fromMs:0,toMs:12*M});assert.equal(r.status,"DATA_GAPS");});
