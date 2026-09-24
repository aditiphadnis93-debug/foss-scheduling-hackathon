import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Move, ScheduleRequestPeriod } from '@workspace/api-client-react';
import { addDays, format } from 'date-fns';

interface ScheduleContextType {
  moves: Move[];
  addMove: (move: Move) => void;
  removeMove: (caseId: string) => void;
  clearMoves: () => void;
  startDate: string;
  setStartDate: (date: string) => void;
  period: ScheduleRequestPeriod;
  setPeriod: (period: ScheduleRequestPeriod) => void;
}

const ScheduleContext = createContext<ScheduleContextType | undefined>(undefined);

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [moves, setMoves] = useState<Move[]>(() => {
    try { return JSON.parse(localStorage.getItem('planner-moves') || '[]'); } catch { return []; }
  });
  const [startDate, updateStartDate] = useState<string>(() => localStorage.getItem('planner-start') || format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [period, updatePeriod] = useState<ScheduleRequestPeriod>(() => (localStorage.getItem('planner-period') as ScheduleRequestPeriod) || 'day');
  const setStartDate = (date: string) => { if (date !== startDate) setMoves([]); updateStartDate(date); };
  const setPeriod = (value: ScheduleRequestPeriod) => { if (value !== period) setMoves([]); updatePeriod(value); };
  useEffect(() => { localStorage.setItem('planner-moves', JSON.stringify(moves)); }, [moves]);
  useEffect(() => { localStorage.setItem('planner-start', startDate); }, [startDate]);
  useEffect(() => { localStorage.setItem('planner-period', period); }, [period]);

  const addMove = (move: Move) => {
    setMoves((prev) => {
      const existingIndex = prev.findIndex((m) => m.caseId === move.caseId);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = move;
        return next;
      }
      return [...prev, move];
    });
  };

  const removeMove = (caseId: string) => {
    setMoves((prev) => prev.filter((m) => m.caseId !== caseId));
  };

  const clearMoves = () => {
    setMoves([]);
  };

  return (
    <ScheduleContext.Provider value={{ 
      moves, addMove, removeMove, clearMoves,
      startDate, setStartDate,
      period, setPeriod
    }}>
      {children}
    </ScheduleContext.Provider>
  );
}

export function useScheduleContext() {
  const context = useContext(ScheduleContext);
  if (context === undefined) {
    throw new Error('useScheduleContext must be used within a ScheduleProvider');
  }
  return context;
}