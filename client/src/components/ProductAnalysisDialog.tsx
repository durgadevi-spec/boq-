import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, History, MapPin, Briefcase, Calendar, Info } from "lucide-react";
import { getJSON } from "@/lib/api";
import { computeBoq, basisFromTableData, linesFromTableData } from "@/lib/boqCalc";
import { format } from "date-fns";

interface HistoryRecord {
  id: string;
  project_name: string;
  project_area: string;
  table_data: any;
  created_at: string;
}

interface ProductAnalysisDialogProps {
  productName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ProductAnalysisDialog({
  productName,
  isOpen,
  onClose,
}: ProductAnalysisDialogProps) {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && productName) {
      const fetchHistory = async () => {
        const trimmedName = productName.trim();
        if (!trimmedName) return;
        
        console.log(`[AnalysisDialog] Fetching history for: "${trimmedName}"`);
        setLoading(true);
        try {
          const data = await getJSON<{ items: HistoryRecord[] }>(
            `/api/boq-items/history/${encodeURIComponent(trimmedName)}`
          );
          console.log(`[AnalysisDialog] Received ${data.items?.length || 0} items`);
          setHistory(data.items || []);
        } catch (err) {
          console.error("Failed to fetch product history", err);
          setHistory([]);
        } finally {
          setLoading(false);
        }
      };
      fetchHistory();
    }
  }, [isOpen, productName]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl p-0 overflow-hidden bg-white border shadow-2xl rounded-xl">
        <DialogHeader className="p-5 border-b bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white border rounded-lg shadow-sm">
              <History className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-slate-900">
                Product History
              </DialogTitle>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Previous usage analysis for <span className="text-blue-600 font-bold">{productName}</span>
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto max-h-[75vh] p-4 bg-white">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm font-medium">Fetching history...</p>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="p-4 bg-slate-50 rounded-full">
                <Info className="h-8 w-8 text-slate-300" />
              </div>
              <div>
                <p className="text-slate-500 font-bold">No Records Found</p>
                <p className="text-xs text-slate-400 mt-1">This product hasn't been used in previous projects yet.</p>
              </div>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden border-slate-200 shadow-sm">
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow>
                    <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider py-3">Project & Area</TableHead>
                    <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center py-3">Target Qty</TableHead>
                    <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center py-3">Rate</TableHead>
                    <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center py-3">Total</TableHead>
                    <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right py-3">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((record) => {
                    const td = record.table_data || {};
                    const basis = basisFromTableData(td);
                    const lines = linesFromTableData(td);
                    const target = Number(td.targetRequiredQty || 0);
                    const { grandTotal, ratePerUnit } = computeBoq(basis, lines, target);

                    return (
                      <TableRow key={record.id} className="hover:bg-slate-50/50 transition-colors border-b last:border-0">
                        <TableCell className="py-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              <Briefcase className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className="font-bold text-slate-800 text-xs truncate max-w-[150px]">{record.project_name}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <MapPin className="h-3 w-3 text-rose-400 shrink-0" />
                              <span className="text-[10px] font-bold text-slate-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                                {record.project_area || "Main Area"}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center py-4">
                          <div className="flex flex-col items-center">
                            <span className="text-xs font-bold text-slate-700">
                              {target.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-[9px] text-slate-400 font-medium">
                              {basis.requiredUnitType}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center py-4">
                          <span className="text-xs font-black text-blue-700">
                            ₹{ratePerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </TableCell>
                        <TableCell className="text-center py-4">
                          <span className="text-xs font-black text-slate-900">
                            ₹{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </TableCell>
                        <TableCell className="text-right py-4">
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] font-bold text-slate-600">
                              {format(new Date(record.created_at), "dd MMM yyyy")}
                            </span>
                            <Calendar className="h-3 w-3 text-slate-300 mt-1" />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-all shadow-md active:scale-95"
          >
            Close Analysis
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
