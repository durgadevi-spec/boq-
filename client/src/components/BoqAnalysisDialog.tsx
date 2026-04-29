import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, BarChart3, Calendar } from "lucide-react";
import apiFetch from "@/lib/api";
import { format } from "date-fns";

type ComparisonProject = {
  projectName: string;
  overrideTotal: number;
  overrideRateTotal: number;
  supplyRateTotal: number;
  supplyAmountTotal: number;
  labourRateTotal: number;
  labourAmountTotal: number;
  finalTotal: number;
  completedDate: string;
};

interface BoqAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const BoqAnalysisDialog: React.FC<BoqAnalysisDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<ComparisonProject[]>([]);

  useEffect(() => {
    if (open) {
      loadComparisonData();
    }
  }, [open]);

  const loadComparisonData = async () => {
    setLoading(true);
    try {
      const response = await apiFetch("/api/boq-analysis/comparison");
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
      }
    } catch (err) {
      console.error("Failed to load comparison data:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col p-0">
        <div className="p-6 pb-0">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                <BarChart3 size={24} />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">Cost Analysis</DialogTitle>
                <DialogDescription className="text-xs">
                  Comparing last 3 completed BOQ projects.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="animate-spin text-blue-500" size={40} />
            <p className="text-slate-500 font-medium text-sm">Fetching comparison data...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20 mx-6 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
            <p className="text-slate-400 text-sm">No previous completed projects found for comparison.</p>
          </div>
        ) : (
          <div className="p-6 pt-4 space-y-6 flex-1">
            <div className="grid grid-cols-3 gap-3">
              {projects.map((p, i) => (
                <div key={i} className="p-3 rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-2">
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[9px] h-4 px-1.5 font-bold">Project {i + 1}</Badge>
                    <div className="flex items-center text-[9px] text-slate-400 font-medium">
                      {p.completedDate ? format(new Date(p.completedDate), "dd MMM yy") : "N/A"}
                    </div>
                  </div>
                  <h3 className="font-bold text-slate-800 text-[11px] mb-2 truncate" title={p.projectName}>{p.projectName}</h3>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-500">Total</span>
                      <span className="font-bold text-slate-900">{formatCurrency(p.finalTotal)}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                      <div className="bg-blue-500 h-full" style={{ width: '100%' }}></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="font-bold text-slate-900 min-w-[160px] text-[11px] py-3">Cost Component</TableHead>
                    {projects.map((p, i) => (
                      <TableHead key={i} className="text-right font-bold text-slate-900 text-[11px] py-3">
                        {p.projectName.length > 15 ? p.projectName.substring(0, 15) + "..." : p.projectName}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { label: "Override Total", key: "overrideTotal", color: "text-blue-600 font-bold" },
                    { label: "Override Rate ", key: "overrideRateTotal" },
                    { label: "Supply Rate ", key: "supplyRateTotal" },
                    { label: "Supply Amount ", key: "supplyAmountTotal", bold: true },
                    { label: "Labour Rate ", key: "labourRateTotal" },
                    { label: "Labour Amount ", key: "labourAmountTotal", bold: true },
                  ].map((row, idx) => (
                    <TableRow key={idx} className="hover:bg-slate-50/50 border-slate-100">
                      <TableCell className="text-[11px] py-2.5 font-medium text-slate-600">{row.label}</TableCell>
                      {projects.map((p, i) => (
                        <TableCell key={i} className={`text-right text-[11px] py-2.5 ${row.color || (row.bold ? "font-semibold text-slate-900" : "text-slate-600")}`}>
                          {formatCurrency((p as any)[row.key])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow className="bg-blue-50/50 font-bold border-t-2 border-blue-100">
                    <TableCell className="text-slate-900 text-[12px] py-3 flex items-center gap-2">
                      <TrendingUp size={14} className="text-green-600" />
                      Final Total
                    </TableCell>
                    {projects.map((p, i) => (
                      <TableCell key={i} className="text-right text-[12px] py-3 text-slate-900">
                        {formatCurrency(p.finalTotal)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="flex justify-end p-6 pt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close Analysis</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
