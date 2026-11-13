import { describe, expect, it } from 'vitest'
import { findNextFreeSlot, findWorkTaskConflict, intersectsLunch } from '@/lib/work-schedule'
import type { TimelineBlockRecord } from '@/types/timeline'

function block(id:string,startTime:string,endTime:string,status:TimelineBlockRecord['status']='planned'):TimelineBlockRecord{return {id,title:id,category:'work',startTime,endTime,durationMinutes:60,energyLevelRequired:3,status,isConflictFree:true,createdAt:'',updatedAt:'',dateKey:'2026-10-31'}}

describe('protected work scheduling',()=>{
 it('blocks any interval overlapping 13:00 to 14:00 local time',()=>{
  const date=new Date(2026,9,31,12,30);expect(intersectsLunch(date,new Date(date.getTime()+60*60_000))).toBe(true)
  const safe=new Date(2026,9,31,14,0);expect(intersectsLunch(safe,new Date(safe.getTime()+60*60_000))).toBe(false)
 })
 it('detects active scheduled overlaps and allows completed blocks to share a slot',()=>{
  const candidate=block('b','2026-10-31T10:00:00','2026-10-31T11:00:00')
  expect(findWorkTaskConflict(candidate,[block('a','2026-10-31T09:30:00','2026-10-31T10:30:00')])?.id).toBe('a')
  expect(findWorkTaskConflict(candidate,[block('a','2026-10-31T09:30:00','2026-10-31T10:30:00','completed')])).toBeUndefined()
 })
})

describe('elastic next-free-slot scheduler',()=>{
 it('moves a slot past a busy interval on the same day',()=>{
  const desired=new Date(2026,9,31,9,0)
  const next=findNextFreeSlot(desired,60,[{startTime:'2026-10-31T09:00:00',endTime:'2026-10-31T10:00:00'}])
  expect(next?.getHours()).toBe(10)
  expect(next?.getMinutes()).toBe(0)
 })
 it('never schedules a task across the protected lunch hour',()=>{
  const next=findNextFreeSlot(new Date(2026,9,31,12,30),60,[])
  expect(next?.getHours()).toBe(14)
  expect(next?.getMinutes()).toBe(0)
 })
 it('ignores completed blocks and returns null when the horizon is full',()=>{
  const desired=new Date(2026,9,31,8,0)
  const completed=[{startTime:'2026-10-31T08:00:00',endTime:'2026-10-31T09:00:00',status:'completed' as const}]
  expect(findNextFreeSlot(desired,60,completed)?.getHours()).toBe(8)
  const fullDay=Array.from({length:13},(_,index)=>({startTime:new Date(2026,9,31,8+index,0).toISOString(),endTime:new Date(2026,9,31,9+index,0).toISOString()}))
  expect(findNextFreeSlot(desired,60,fullDay,{horizonDays:1,dayStartHour:8,dayEndHour:21})).toBeNull()
 })
})
