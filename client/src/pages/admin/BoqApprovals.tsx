import React, { useEffect, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Loader2, CheckCircle2, XCircle, Eye, FileText } from "lucide-react";
import apiFetch from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { computeBoq, linesFromTableData, basisFromTableData } from "@/lib/boqCalc";

// ─── Shared helpers (mirrored from FinalizeBoq.tsx) ────────────────────────
const applyOperator = (base: number, mult: number, op: string) => {
  if (op === "%") return base * (mult / 100);
  if (op === "*") return base * mult;
  if (op === "/") return mult !== 0 ? base / mult : 0;
  return base + mult; // "+"
};

type SrcCtx = {
  totalVal: number; rate: number; qty: number;
  overrideRate: number; overrideTotal: number;
  rowCalc: Record<string, number>;
  customVals: Record<string, string>;
};

const resolveSource = (src: string, ctx: SrcCtx): number => {
  if (src === "Total Value (₹)") return ctx.totalVal;
  if (src === "Rate / Unit") return ctx.rate;
  if (src === "Qty") return ctx.qty;
  if (src === "Override Rate") return ctx.overrideRate;
  if (src === "Override Total") return ctx.overrideTotal;
  if (ctx.rowCalc[src] !== undefined) return ctx.rowCalc[src];
  return parseFloat(ctx.customVals[src] || "0") || 0;
};

const getItemMetrics = (td: any) => {
  const step11 = Array.isArray(td.step11_items) ? td.step11_items : [];
  let itemTotal = 0, itemQty = 0;
  if (td.targetRequiredQty !== undefined && td.targetRequiredQty !== null) {
    if (td.materialLines) {
      const res = computeBoq(td.configBasis, td.materialLines, td.targetRequiredQty);
      const manualTotal = step11.filter((it: any) => it.manual).reduce((s: number, it: any) =>
        s + (Number(it.qty) || 0) * (Number(it.supply_rate || 0) + Number(it.install_rate || 0)), 0);
      itemTotal = res.grandTotal + manualTotal;
    } else {
      itemTotal = step11.reduce((s: number, it: any) =>
        s + (it.qty || 0) * ((it.supply_rate || 0) + (it.install_rate || 0)), 0);
    }
    itemQty = td.targetRequiredQty;
  } else {
    itemTotal = step11.reduce((s: number, it: any) =>
      s + (it.qty || 0) * ((it.supply_rate || 0) + (it.install_rate || 0)), 0);
    itemQty = step11[0]?.qty || 0;
  }
  let finalRate = itemQty > 0 ? itemTotal / itemQty : itemTotal;

  if (td.is_lump_sum) {
    itemQty = 1;
    finalRate = itemTotal;
  }

  if (td.use_standard_rate && td.materialLines) {
    try {
      const baseQty = Number(td.configBasis?.baseRequiredQty || 1);
      const resBase = computeBoq({ ...td.configBasis, wastagePctDefault: 0 }, td.materialLines.map((l: any) => ({ ...l, applyWastage: false })), baseQty);
      finalRate = resBase.grandTotal / baseQty;
      itemTotal = finalRate * itemQty;
    } catch { }
  } else if (td.use_fixed_rate) {
    finalRate = Number(td.fixed_rate || 0);
    itemTotal = finalRate * itemQty;
  }
  return { itemTotal, itemQty, itemRate: finalRate, step11 };
};

/** Compute all per-item values matching FinalizeBoq logic exactly */
const computeItemRow = (td: any, cols: any[]) => {
  const { itemRate, itemQty, step11 } = getItemMetrics(td);

  // Use finalize_qty / finalize_unit overrides if present
  const isLumpSum = td.is_lump_sum || (td.finalize_unit || td.unit || '').toLowerCase() === 'ls';
  const displayQty = isLumpSum ? 1 : (
    td.finalize_qty !== undefined && td.finalize_qty !== null
      ? Number(td.finalize_qty)
      : itemQty
  );

  const baseTotalValue = itemRate * displayQty;

  // Override calculation — matches FinalizeBoq exactly
  const overrideInputVal = Number(td.finalize_override_rate || 0);
  const overrideType = td.finalize_override_type || 'value';
  let effectiveOverrideRate = 0;
  if (overrideType === 'percentage') {
    effectiveOverrideRate = itemRate * overrideInputVal / 100;
  } else {
    effectiveOverrideRate = overrideInputVal;
  }
  const overrideMarkupTotal = effectiveOverrideRate * displayQty;
  // % mode: adds markup on top of system total.  ₹ mode: replaces rate entirely.
  const overrideTotalVal = overrideInputVal !== 0
    ? (overrideType === 'percentage' ? (baseTotalValue + overrideMarkupTotal) : overrideMarkupTotal)
    : baseTotalValue;

  // Column calculations — matches FinalizeBoq calculatedColumnTotals logic
  let currentItemRunningTotal = overrideTotalVal;
  let accumulator = 0;
  const rowCalculatedValues: Record<string, number> = {};

  const colValues: number[] = [];
  cols.forEach((col: any) => {
    if (col.isTotal) {
      currentItemRunningTotal += accumulator;
      accumulator = 0;
      rowCalculatedValues[col.name] = currentItemRunningTotal;
      colValues.push(currentItemRunningTotal);
    } else {
      let val = 0;
      const baseSource = col.baseSource;
      const operator = col.operator || "%";
      const multiplierSource = col.multiplierSource || "manual";
      const manualMultiplier = col.percentageValue || 0;

      if (baseSource && baseSource !== "manual") {
        const _ctx: SrcCtx = {
          totalVal: baseTotalValue, rate: itemRate, qty: displayQty,
          overrideRate: effectiveOverrideRate,
          overrideTotal: overrideTotalVal,
          rowCalc: rowCalculatedValues, customVals: {},
        };
        const baseVal = resolveSource(baseSource, _ctx);
        const multiplierVal = multiplierSource === "manual" ? manualMultiplier : resolveSource(multiplierSource, _ctx);
        val = applyOperator(baseVal, multiplierVal, operator);
      } else {
        const multiplier = Number(col.percentageValue || 0);
        const op = col.operator || "%";
        let base = currentItemRunningTotal;
        if (col.baseSource === "Basic Total (₹)" || col.baseSource === "Total Value (₹)") base = baseTotalValue;
        else if (col.baseSource === "Override Total") base = overrideTotalVal;
        else if (col.baseSource && rowCalculatedValues[col.baseSource] !== undefined) base = rowCalculatedValues[col.baseSource];
        val = applyOperator(base, multiplier, op);
      }
      rowCalculatedValues[col.name] = val;
      accumulator += val;
      colValues.push(val);
    }
  });

  return {
    itemRate, displayQty, baseTotalValue, effectiveOverrideRate,
    overrideTotalVal, overrideMarkupTotal, overrideInputVal, overrideType,
    colValues, rowCalculatedValues, step11,
    finalRunningTotal: currentItemRunningTotal + accumulator,
  };
};

type BOQApproval = {
    id: string;
    project_id: string;
    project_name: string;
    project_client: string;
    version_number: number;
    status: string;
    created_at: string;
    updated_at?: string;
    project_value?: number | string;
    type: "bom" | "boq";
    column_config?: any;
};

export default function BoqApprovals() {
    const [approvals, setApprovals] = useState<BOQApproval[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [previewVersion, setPreviewVersion] = useState<BOQApproval | null>(null);
    const [previewItems, setPreviewItems] = useState<any[]>([]);
    const [previewLoading, setPreviewLoading] = useState(false);
    const { toast } = useToast();

    const fetchApprovals = async () => {
        try {
            setLoading(true);
            const res = await apiFetch("/api/bom-approvals");
            if (res.ok) {
                const data = await res.json();
                // Show: all BOQ type versions + BOM versions that Finance has submitted for BOQ approval
                const list = (data.approvals || []).filter((a: any) =>
                    (a.type === 'boq' || a.is_boq_submission === true) && ['submitted', 'pending_approval', 'edit_requested'].includes(a.status)
                );
                setApprovals(list);
            }
        } catch (err) {
            console.error("Failed to load BOQ approvals:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchApprovals();
    }, []);

    const handleApprove = async (id: string, isEditRequest = false) => {
        setActionLoading(id);
        try {
            const url = isEditRequest ? `/api/bom-approvals/${id}/approve-edit` : `/api/bom-approvals/${id}/approve`;
            const res = await apiFetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });
            if (res.ok) {
                toast({ title: "Approved", description: isEditRequest ? "Edit request approved." : "BOQ version approved." });
                if (previewVersion?.id === id) setPreviewVersion(null);
                fetchApprovals();
            } else {
                const data = await res.json();
                toast({ title: "Error", description: data.message || "Failed to approve", variant: "destructive" });
            }
        } catch (err) {
            toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
        } finally {
            setActionLoading(null);
        }
    };

    const handleReject = async (id: string, isEditRequest = false) => {
        const reason = prompt(isEditRequest ? "Reason for rejecting edit request:" : "Please enter a reason for rejection:");
        if (reason === null) return;

        setActionLoading(id);
        try {
            const url = isEditRequest ? `/api/bom-approvals/${id}/reject-edit` : `/api/bom-approvals/${id}/reject`;
            const res = await apiFetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason }),
            });
            if (res.ok) {
                toast({ title: "Rejected", description: isEditRequest ? "Edit request rejected." : "BOQ version rejected." });
                if (previewVersion?.id === id) setPreviewVersion(null);
                fetchApprovals();
            } else {
                const data = await res.json();
                toast({ title: "Error", description: data.message || "Failed to reject", variant: "destructive" });
            }
        } catch (err) {
            toast({ title: "Error", description: "Failed to reject", variant: "destructive" });
        } finally {
            setActionLoading(null);
        }
    };

    const handleClear = async (id: string) => {
        setActionLoading(id);
        try {
            const res = await apiFetch(`/api/bom-approvals/${id}/clear`, { method: "POST" });
            if (res.ok) {
                toast({ title: "Cleared", description: "Record hidden from view." });
                fetchApprovals();
            }
        } catch (err) {
            toast({ title: "Error", description: "Failed to clear record", variant: "destructive" });
        } finally {
            setActionLoading(null);
        }
    };

    const handleOpenPreview = async (approval: BOQApproval) => {
        setPreviewVersion(approval);
        setPreviewLoading(true);
        try {
            const res = await apiFetch(`/api/boq-items/version/${approval.id}`);
            if (res.ok) {
                const data = await res.json();
                setPreviewItems(data.items || []);
            }
        } catch (err) {
            toast({ title: "Error", description: "Failed to load BOQ details", variant: "destructive" });
        } finally {
            setPreviewLoading(false);
        }
    };

    const toggleSelect = (id: string, checked: boolean) => {
        setSelectedIds(prev => checked ? [...prev, id] : prev.filter(item => item !== id));
    };

    const bulkApprove = async () => {
        if (selectedIds.length === 0) return;
        if (!confirm(`Approve ${selectedIds.length} selected BOQ(s)?`)) return;
        setActionLoading("bulk");
        try {
            for (const id of selectedIds) {
                const approval = approvals.find(a => a.id === id);
                const isEditRequest = approval?.status === 'edit_requested';
                const url = isEditRequest ? `/api/bom-approvals/${id}/approve-edit` : `/api/bom-approvals/${id}/approve`;
                await apiFetch(url, { method: "POST" });
            }
            toast({ title: "Approved", description: `${selectedIds.length} BOQ(s) approved.` });
            setSelectedIds([]);
            fetchApprovals();
        } catch (err) {
            toast({ title: "Error", description: "Bulk approve failed", variant: "destructive" });
        } finally {
            setActionLoading(null);
        }
    };

    const bulkReject = async () => {
        if (selectedIds.length === 0) return;
        const reason = prompt(`Reject reason for ${selectedIds.length} BOQ(s):`);
        if (reason === null) return;
        setActionLoading("bulk");
        try {
            for (const id of selectedIds) {
                const approval = approvals.find(a => a.id === id);
                const isEditRequest = approval?.status === 'edit_requested';
                const url = isEditRequest ? `/api/bom-approvals/${id}/reject-edit` : `/api/bom-approvals/${id}/reject`;
                await apiFetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reason }),
                });
            }
            toast({ title: "Rejected", description: `${selectedIds.length} BOQ(s) rejected.` });
            setSelectedIds([]);
            fetchApprovals();
        } catch (err) {
            toast({ title: "Error", description: "Bulk reject failed", variant: "destructive" });
        } finally {
            setActionLoading(null);
        }
    };

    const pendingApprovals = approvals.filter(a => a.status === 'submitted' || a.status === 'pending_approval');
    const editRequests = approvals.filter(a => a.status === 'edit_requested');
    const approvedHistory = approvals.filter(a => a.status === 'approved');

    const renderTable = (list: BOQApproval[], title: string) => {
        if (list.length === 0) return null;

        return (
            <div className="mb-8">
                <h3 className="text-lg font-bold mb-4 text-slate-800">{title}</h3>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[40px]"></TableHead>
                            <TableHead>Project</TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>Version</TableHead>
                            <TableHead className="text-right">Grand Total</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-center">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {list.map((approval) => (
                            <TableRow key={approval.id}>
                                <TableCell>
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300"
                                        checked={selectedIds.includes(approval.id)}
                                        onChange={(e) => toggleSelect(approval.id, e.target.checked)}
                                    />
                                </TableCell>
                                <TableCell className="font-bold">{approval.project_name}</TableCell>
                                <TableCell>{approval.project_client}</TableCell>
                                <TableCell>V{approval.version_number}</TableCell>
                                <TableCell className="text-right font-bold whitespace-nowrap">
                                    {approval.project_value ? `₹${Number(approval.project_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                                </TableCell>
                                <TableCell>
                                    <Badge className={
                                        approval.status === 'approved' ? "bg-green-100 text-green-700" :
                                        approval.status === 'rejected' ? "bg-red-100 text-red-700" :
                                        approval.status === 'edit_requested' ? "bg-indigo-100 text-indigo-700" :
                                        "bg-amber-100 text-amber-700"
                                    }>
                                        {approval.status.replace('_', ' ').toUpperCase()}
                                    </Badge>
                                </TableCell>
                                <TableCell>{new Date(approval.updated_at || approval.created_at).toLocaleDateString()}</TableCell>
                                <TableCell>
                                    <div className="flex items-center justify-center gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleOpenPreview(approval)}
                                            title="View entire BOQ table"
                                        >
                                            <Eye className="h-4 w-4 mr-1" /> View
                                        </Button>
                                        {(approval.status === 'submitted' || approval.status === 'pending_approval' || approval.status === 'edit_requested') && (
                                            <>
                                                <Button
                                                    size="sm"
                                                    className="bg-green-600 hover:bg-green-700 h-8"
                                                    onClick={() => handleApprove(approval.id, approval.status === 'edit_requested')}
                                                    disabled={!!actionLoading}
                                                >
                                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    className="h-8"
                                                    onClick={() => handleReject(approval.id, approval.status === 'edit_requested')}
                                                    disabled={!!actionLoading}
                                                >
                                                    <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                                                </Button>
                                            </>
                                        )}
                                        {approval.status === 'approved' && (
                                             <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleClear(approval.id)}
                                                disabled={!!actionLoading}
                                            >
                                                Clear
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        );
    };

    return (
        <Layout>
            <div className="container mx-auto py-8 px-4">
                <Card className="max-w-6xl mx-auto shadow-xl">
                    <CardHeader className="bg-muted/50 border-b flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="text-2xl">BOQ Approvals</CardTitle>
                            <p className="text-sm text-muted-foreground mt-1">Review finalized BOQ versions and edit requests.</p>
                        </div>
                        {selectedIds.length > 0 && (
                            <div className="flex gap-2">
                                <Button size="sm" className="bg-green-600" onClick={bulkApprove}>Approve Selected ({selectedIds.length})</Button>
                                <Button size="sm" variant="destructive" onClick={bulkReject}>Reject Selected</Button>
                            </div>
                        )}
                    </CardHeader>
                    <CardContent className="p-6">
                        {loading ? (
                            <div className="flex flex-col items-center py-12">
                                <Loader2 className="h-12 w-12 animate-spin text-primary opacity-50" />
                                <p className="mt-4 text-muted-foreground">Loading approval requests...</p>
                            </div>
                        ) : (
                            <Tabs defaultValue="pending" className="w-full">
                                <TabsList className="mb-6">
                                    <TabsTrigger value="pending">Pending ({pendingApprovals.length + editRequests.length})</TabsTrigger>
                                    <TabsTrigger value="history">Recently Approved ({approvedHistory.length})</TabsTrigger>
                                </TabsList>
                                <TabsContent value="pending">
                                    {renderTable(editRequests, "Edit Requests")}
                                    {renderTable(pendingApprovals, "Pending BOQ Approvals")}
                                    {pendingApprovals.length === 0 && editRequests.length === 0 && (
                                        <div className="text-center py-12 border-2 border-dashed rounded-lg bg-slate-50">
                                            <FileText className="h-12 w-12 mx-auto text-slate-300 mb-4" />
                                            <h3 className="text-lg font-medium text-slate-600">No pending approvals</h3>
                                            <p className="text-muted-foreground">Everything is up to date.</p>
                                        </div>
                                    )}
                                </TabsContent>
                                <TabsContent value="history">
                                    {renderTable(approvedHistory, "Completed Approvals")}
                                    {approvedHistory.length === 0 && (
                                        <div className="text-center py-12 border-2 border-dashed rounded-lg bg-slate-50">
                                            <CheckCircle2 className="h-12 w-12 mx-auto text-slate-300 mb-4" />
                                            <h3 className="text-lg font-medium text-slate-600">No approved records</h3>
                                            <p className="text-muted-foreground">Once you approve a BOQ, it will show up here.</p>
                                        </div>
                                    )}
                                </TabsContent>
                            </Tabs>
                        )}
                    </CardContent>

                    <Dialog open={!!previewVersion} onOpenChange={(open) => !open && setPreviewVersion(null)}>
                        <DialogContent className="max-w-[95vw] w-[1400px] h-[90vh] flex flex-col p-0 overflow-hidden">
                            <DialogHeader className="p-6 bg-slate-900 text-white flex flex-row items-center justify-between space-y-0">
                                <div>
                                    <DialogTitle className="text-xl">BOQ Preview: {previewVersion?.project_name}</DialogTitle>
                                    <DialogDescription className="text-slate-400">
                                        Version V{previewVersion?.version_number} • {previewVersion?.project_client} • {previewVersion && new Date(previewVersion.created_at).toLocaleDateString()}
                                    </DialogDescription>
                                </div>
                                <div className="flex gap-2 mr-6">
                                    <Badge className="bg-blue-600 text-white border-0 uppercase px-3">{previewVersion?.status}</Badge>
                                </div>
                            </DialogHeader>
                            <div className="flex-1 overflow-hidden flex flex-col">
                                {previewLoading ? (
                                    <div className="h-full flex flex-col items-center justify-center">
                                        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
                                        <p>Fetching entire BOQ table...</p>
                                    </div>
                                ) : (
                                    <div className="flex-1 overflow-auto p-6 scrollbar-thin scrollbar-thumb-slate-300">
                                        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm inline-block min-w-full">
                                            <Table className="min-w-[1600px]">
                                                <TableHeader className="bg-slate-50 sticky top-0 z-10">
                                                    <TableRow>
                                                        {(() => {
                                                            let cols = previewVersion?.column_config;
                                                            if (typeof cols === 'string') try { cols = JSON.parse(cols); } catch { cols = null; }
                                                            if (!cols || (Array.isArray(cols) && cols.length === 0)) {
                                                                if (previewItems.length > 0) {
                                                                    let td = previewItems[0].table_data;
                                                                    if (typeof td === 'string') try { td = JSON.parse(td); } catch { td = {}; }
                                                                    cols = td.finalize_columns || [];
                                                                }
                                                            }
                                                            if (!Array.isArray(cols)) cols = [];
                                                            return (
                                                                <>
                                                                    <TableHead className="w-[50px] border-r">#</TableHead>
                                                                    <TableHead className="min-w-[200px] border-r text-[10px] uppercase font-bold">Product / Material</TableHead>
                                                                    <TableHead className="min-w-[250px] border-r text-[10px] uppercase font-bold text-center">Description</TableHead>
                                                                    <TableHead className="border-r text-[10px] uppercase font-bold text-center">Unit</TableHead>
                                                                    <TableHead className="border-r text-[10px] uppercase font-bold text-center">Qty</TableHead>
                                                                    <TableHead className="border-r text-[10px] uppercase font-bold text-right">Rate</TableHead>
                                                                    <TableHead className="border-r text-[10px] uppercase font-bold text-right bg-slate-50">System Total (J)</TableHead>
                                                                    <TableHead className="border-r text-[10px] uppercase font-bold text-right bg-blue-50/30">Rate (K)</TableHead>
                                                                    <TableHead className="border-r text-[10px] uppercase font-bold text-right bg-blue-50/30">Total (L)</TableHead>
                                                                    {cols.map((c: any, i: number) => (
                                                                        <TableHead key={i} className="border-r text-[10px] uppercase font-bold text-right bg-slate-50/50">{c.name}</TableHead>
                                                                    ))}
                                                                </>
                                                            );
                                                        })()}
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {previewItems.map((item, idx) => {
                                                        let td = item.table_data || {};
                                                        if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }
                                                        const productName = td.product_name || item.estimator || "—";

                                                        // Get columns
                                                        let cols = previewVersion?.column_config;
                                                        if (typeof cols === 'string') try { cols = JSON.parse(cols); } catch { cols = null; }
                                                        if (!cols || (Array.isArray(cols) && cols.length === 0)) {
                                                            if (previewItems.length > 0) {
                                                                let firstTd = previewItems[0].table_data;
                                                                if (typeof firstTd === 'string') try { firstTd = JSON.parse(firstTd); } catch { firstTd = {}; }
                                                                cols = firstTd.finalize_columns || [];
                                                            }
                                                        }
                                                        if (!Array.isArray(cols)) cols = [];

                                                        const row = computeItemRow(td, cols);

                                                        return (
                                                            <TableRow key={item.id} className="hover:bg-slate-50/50">
                                                                <TableCell className="font-medium text-slate-500 border-r">{idx + 1}</TableCell>
                                                                <TableCell className="font-bold text-slate-800 border-r text-[10px]">{productName}</TableCell>
                                                                <TableCell className="text-slate-600 text-[10px] border-r max-w-[300px] leading-tight italic">{td.finalize_description || td.subcategory || row.step11[0]?.description || "—"}</TableCell>
                                                                <TableCell className="border-r text-center text-[10px] font-semibold">{td.finalize_unit || td.unit || "nos"}</TableCell>
                                                                <TableCell className="text-center font-mono border-r text-[10px] font-bold">{row.displayQty}</TableCell>
                                                                <TableCell className="text-right font-mono border-r text-[10px] text-slate-500">₹{row.itemRate.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                                                <TableCell className="text-right font-bold text-slate-700 bg-slate-50/10 border-r text-[10px]">₹{row.baseTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                                                <TableCell className={`text-right font-mono border-r text-[10px] ${row.effectiveOverrideRate > 0 ? "text-blue-600 font-bold bg-blue-50/30" : "text-slate-400"}`}>₹{row.effectiveOverrideRate.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                                                <TableCell className={`text-right font-bold border-r text-[10px] ${row.overrideTotalVal !== row.baseTotalValue ? "text-blue-700 bg-blue-50/30" : "text-slate-400"}`}>₹{row.overrideTotalVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                                                {row.colValues.map((cellVal: number, i: number) => (
                                                                    <TableCell key={i} className={`text-right border-r text-[10px] ${cols[i]?.isTotal ? "font-black text-blue-800 bg-blue-50/40" : "text-slate-600 font-medium"}`}>
                                                                        ₹{cellVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                                    </TableCell>
                                                                ))}
                                                            </TableRow>
                                                        );
                                                    })}
                                                </TableBody>
                                            </Table>
                                        </div>
                                        <div className="mt-6 flex justify-end">
                                            <div className="bg-slate-50 border p-4 rounded-lg min-w-[300px] shadow-sm">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Total Product Items</span>
                                                    <span className="font-bold text-slate-700">{previewItems.length}</span>
                                                </div>
                                                <div className="flex justify-between items-end border-t border-slate-200 pt-2 mt-2">
                                                    <span className="text-[11px] font-black text-slate-500 uppercase">Grand Total Value</span>
                                                    <span className="text-2xl font-black text-blue-900 tracking-tighter">
                                                        ₹{(parseFloat((previewVersion?.project_value as any) || "0")).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <DialogFooter className="p-6 bg-slate-50 border-t flex items-center justify-between">
                                <Button variant="outline" onClick={() => setPreviewVersion(null)}>Close Preview</Button>
                                <div className="flex gap-3">
                                    <Button 
                                        variant="destructive" 
                                        className="px-8"
                                        onClick={() => {
                                            handleReject(previewVersion!.id, previewVersion?.status === 'edit_requested');
                                        }}
                                    >
                                        Reject
                                    </Button>
                                    <Button 
                                        className="bg-green-600 hover:bg-green-700 text-white px-8"
                                        onClick={() => {
                                            handleApprove(previewVersion!.id, previewVersion?.status === 'edit_requested');
                                        }}
                                    >
                                        Approve BOQ
                                    </Button>
                                </div>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </Card>
            </div>
        </Layout>
    );
}
