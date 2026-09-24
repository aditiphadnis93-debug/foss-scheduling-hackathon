import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { Move } from '@workspace/api-client-react';

interface MovesContextType {
  moves: Move[];
  addMove: (move: Move) => void;
  removeMove: (caseId: string) => void;
  clearMoves: () => void;
}

const MovesContext = createContext<MovesContextType | undefined>(undefined);

export function MovesProvider({ children }: { children: ReactNode }) {
  const [moves, setMoves] = useState<Move[]>([]);

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
    <MovesContext.Provider value={{ moves, addMove, removeMove, clearMoves }}>
      {children}
    </MovesContext.Provider>
  );
}

export function useMoves() {
  const context = useContext(MovesContext);
  if (context === undefined) {
    throw new Error('useMoves must be used within a MovesProvider');
  }
  return context;
}