import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import apiFetch from "@/lib/api";
import { computeBoq } from "@/lib/boqCalc";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from 'xlsx-js-style';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  X,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  ArrowRightLeft,
  Scale,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

type VersionCompareModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currentVersionId: string | null;
  projects: any[];
};

export function VersionCompareModal({
  open,
  onOpenChange,
  projectId,
  currentVersionId,
  projects,
}: VersionCompareModalProps) {
  const { toast } = useToast();
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectId);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [baseVersionId, setBaseVersionId] = useState<string>(currentVersionId || "");
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const [baseItems, setBaseItems] = useState<any[]>([]);
  const [compareItems, setCompareItems] = useState<any[]>([]);

  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  const [showComparison, setShowComparison] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [isColumnsExpanded, setIsColumnsExpanded] = useState(true);

  useEffect(() => {
    if (open) {
      setSelectedProjectId(projectId);
      setBaseVersionId(currentVersionId || "");
      setSelectedVersionId("");
      setShowComparison(false);
      setSelectedColumns([]);
    }
  }, [open, projectId, currentVersionId]);

  useEffect(() => {
    if (open && selectedProjectId) {
      loadVersions(selectedProjectId);
    }
  }, [open, selectedProjectId]);

  const loadVersions = async (pId: string) => {
    setLoading(true);
    try {
      const [bomResp, boqResp] = await Promise.all([
        apiFetch(`/api/boq-versions/${encodeURIComponent(pId)}?type=bom`),
        apiFetch(`/api/boq-versions/${encodeURIComponent(pId)}?type=boq`)
      ]);
      let allVersions: any[] = [];
      if (bomResp.ok) {
        const bomData = await bomResp.json();
        const validBom = (bomData.versions || []).filter((v: any) => v.status === "approved" && !v.is_disabled);
        allVersions = [...allVersions, ...validBom];
      }
      if (boqResp.ok) {
        const boqData = await boqResp.json();
        const validBoq = (boqData.versions || []).filter((v: any) => !v.is_disabled);
        allVersions = [...allVersions, ...validBoq];
      }
      allVersions.sort((a, b) => b.version_number - a.version_number);
      setVersions(allVersions);
    } catch (err) {
      console.error("Failed to load versions:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadVersionData = async (versionId: string) => {
    if (!versionId) return [];
    try {
      const resp = await apiFetch(`/api/boq-items/version/${encodeURIComponent(versionId)}`);
      if (resp.ok) {
        const data = await resp.json();
        return data.items || [];
      }
    } catch (err) {
      console.error("Failed to load version items:", err);
    }
    return [];
  };

  const handleStartComparison = async () => {
    if (!baseVersionId || !selectedVersionId) {
      toast({ title: "Validation Error", description: "Please select both versions to compare.", variant: "destructive" });
      return;
    }
    setLoadingData(true);
    try {
      const [baseData, compareData] = await Promise.all([
        loadVersionData(baseVersionId),
        loadVersionData(selectedVersionId)
      ]);
      setBaseItems(baseData);
      setCompareItems(compareData);

      const cols = new Set<string>();
      cols.add("Rate");
      cols.add("Qty");
      cols.add("Total");
      cols.add("Override Rate");
      cols.add("Override Total");

      [...baseData, ...compareData].forEach(item => {
        let td = item.table_data || {};
        if (typeof td === "string") try { td = JSON.parse(td); } catch { }
        if (Array.isArray(td.finalize_columns)) {
          td.finalize_columns.forEach((c: any) => {
            if (c.name) cols.add(c.name);
          });
        }
      });

      const colsArr = Array.from(cols);
      setAvailableColumns(colsArr);
      setSelectedColumns(colsArr.slice(0, 5));
      setShowComparison(true);
    } catch (e) {
      toast({ title: "Error", description: "Failed to load comparison data", variant: "destructive" });
    } finally {
      setLoadingData(false);
    }
  };

  const getItemMetrics = (td: any, item: any, isLumpSum: boolean) => {
    const step11 = Array.isArray(td.step11_items) ? td.step11_items : [];
    let itemTotal = 0, itemQty = 0;
    if (td.materialLines && td.targetRequiredQty !== undefined) {
      try {
        const res = computeBoq(td.configBasis, td.materialLines, td.targetRequiredQty);
        const manualTotal = step11.filter((it: any) => it.manual).reduce((s: number, it: any) =>
          s + (Number(it.qty) || 0) * (Number(it.supply_rate || 0) + Number(it.install_rate || 0)), 0);
        itemTotal = res.grandTotal + manualTotal;
      } catch { }
      itemQty = td.targetRequiredQty;
    } else {
      itemTotal = step11.reduce((s: number, it: any) =>
        s + (it.qty || 0) * ((it.supply_rate || 0) + (it.install_rate || 0)), 0);
      itemQty = step11[0]?.qty || 0;
    }

    let rate = itemQty > 0 ? itemTotal / itemQty : itemTotal;
    if (isLumpSum) { itemQty = 1; rate = itemTotal; }

    const displayQty = td.finalize_qty !== undefined && td.finalize_qty !== null
      ? parseFloat(String(td.finalize_qty)) || 0
      : itemQty;

    const effectiveQty = isLumpSum ? 1 : displayQty;
    const finalTotal = rate * effectiveQty;

    const overrideType = td.finalize_override_type || "value";
    const overrideInputVal = parseFloat(String(td.finalize_override_rate || "0")) || 0;
    let overrideRate = 0;
    if (overrideType === "percentage") {
      overrideRate = finalTotal * overrideInputVal / 100 / effectiveQty;
    } else {
      overrideRate = overrideInputVal;
    }

    const overrideTotal = overrideRate * effectiveQty;

    return {
      Rate: rate,
      Qty: effectiveQty,
      Total: finalTotal,
      "Override Rate": overrideRate,
      "Override Total": overrideTotal,
      currentRunningTotal: overrideRate > 0 ? overrideTotal : finalTotal
    };
  };

  const extractItemData = (item: any) => {
    if (!item) return null;
    let td = item.table_data || {};
    if (typeof td === "string") try { td = JSON.parse(td); } catch { td = {}; }

    const isLumpSum = td.is_lump_sum === true || (String(td.finalize_unit || "").toLowerCase() === 'ls');
    const metrics = getItemMetrics(td, item, isLumpSum);

    const currentStep11Items = Array.isArray(td.step11_items) ? td.step11_items : [];
    const derivedProductName = td.product_name || item.estimator || "—";
    const productName = (derivedProductName === "Manual Product" || derivedProductName === "Manual" || item.estimator === "manual_product" || item.estimator === "Manual")
      ? (currentStep11Items[0]?.title || currentStep11Items[0]?.description || derivedProductName)
      : derivedProductName;

    const itemData: any = {
      productName,
      unit: td.finalize_unit || "nos",
      ...metrics
    };

    let accumulator = 0;
    let runningTotal = metrics.currentRunningTotal;

    if (Array.isArray(td.finalize_columns) && td.finalize_column_values && td.finalize_column_values[0]) {
      td.finalize_columns.forEach((col: any) => {
        if (col.isTotal) {
          runningTotal += accumulator;
          accumulator = 0;
          itemData[col.name] = runningTotal;
        } else {
          const val = parseFloat(td.finalize_column_values[0][col.name] || "0") || 0;
          itemData[col.name] = val;
          accumulator += val;
        }
      });
    }

    return itemData;
  };

  const comparisonData = useMemo(() => {
    if (!showComparison) return [];

    const productMap = new Map<string, { base: any, compare: any }>();

    baseItems.forEach(item => {
      const data = extractItemData(item);
      if (data) {
        const key = data.productName;
        if (!productMap.has(key)) productMap.set(key, { base: data, compare: null });
      }
    });

    compareItems.forEach(item => {
      const data = extractItemData(item);
      if (data) {
        const key = data.productName;
        if (productMap.has(key)) {
          productMap.get(key)!.compare = data;
        } else {
          productMap.set(key, { base: null, compare: data });
        }
      }
    });

    return Array.from(productMap.entries()).map(([name, data]) => ({
      name,
      ...data
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [baseItems, compareItems, showComparison]);

  // Summary stats
  const summaryStats = useMemo(() => {
    if (!showComparison || !selectedColumns.includes("Total")) return null;
    let increased = 0, decreased = 0, unchanged = 0, added = 0, removed = 0, modified = 0;
    let baseTotal = 0, compareTotal = 0;
    
    comparisonData.forEach(row => {
      const bTotal = row.base ? (row.base["Total"] || 0) : 0;
      const cTotal = row.compare ? (row.compare["Total"] || 0) : 0;
      baseTotal += bTotal;
      compareTotal += cTotal;

      if (!row.base) { added++; return; }
      if (!row.compare) { removed++; return; }
      
      const diff = cTotal - bTotal;
      if (Math.abs(diff) < 0.01) unchanged++;
      else {
        modified++;
        if (diff > 0) increased++;
        else decreased++;
      }
    });
    
    const costDifference = compareTotal - baseTotal;
    
    return { increased, decreased, unchanged, added, removed, modified, total: comparisonData.length, baseTotal, compareTotal, costDifference };
  }, [comparisonData, showComparison, selectedColumns]);

  const handleDownloadPdf = async () => {
    try {
      const doc = new jsPDF({ orientation: "landscape" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginX = 10;

      const selProj = projects.find(p => p.id === selectedProjectId);
      const baseVer = versions.find(v => v.id === baseVersionId);
      const compVer = versions.find(v => v.id === selectedVersionId);

      // --- Professional Header Box ---
      const headerBoxY = 8;
      const headerBoxH = 28;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      const boxRight = pageWidth - marginX;
      const boxBottom = headerBoxY + headerBoxH;
      doc.line(marginX, headerBoxY, boxRight, headerBoxY);
      doc.line(marginX, headerBoxY, marginX, boxBottom);
      doc.line(boxRight, headerBoxY, boxRight, boxBottom);

      // Logo
      let logoDataUrl: string | null = null;
      try {
        const resp = await fetch("/image.png");
        const blob = await resp.blob();
        const reader = new FileReader();
        logoDataUrl = await new Promise<string | null>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn("Could not load logo for PDF header", e);
      }
      if (logoDataUrl) {
        const imgProps: any = doc.getImageProperties(logoDataUrl);
        const imgH = 22;
        const imgW = (imgProps.width / imgProps.height) * imgH;
        doc.addImage(logoDataUrl, "PNG", marginX + 2, headerBoxY + 3, imgW, imgH);
      }

      doc.setFontSize(15);
      doc.setFont("helvetica", "bold");
      doc.text("VERSION COMPARISON REPORT", pageWidth / 2, headerBoxY + 13, { align: "center" });

      const metaX = pageWidth - marginX - 2;
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text(`Project: ${selProj?.name || "-"}`, metaX, headerBoxY + 7, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.text(`Compared: V${baseVer?.version_number} vs V${compVer?.version_number}`, metaX, headerBoxY + 13, { align: "right" });
      doc.text(`Date: ${new Date().toLocaleDateString()}`, metaX, headerBoxY + 19, { align: "right" });
      doc.text(`Generated: ${new Date().toLocaleTimeString()}`, metaX, headerBoxY + 25, { align: "right" });

      // --- Summary Section ---
      let startY = boxBottom + 2;
      if (summaryStats) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.text("Summary:", marginX, startY + 5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        const summaryLine1 = `Total Items: ${summaryStats.total}  |  Added: ${summaryStats.added}  |  Deleted: ${summaryStats.removed}  |  Modified: ${summaryStats.modified}`;
        const summaryLine2 = `Prev Version Total: \u20b9${Number(summaryStats.baseTotal.toFixed(2)).toLocaleString('en-IN')}  |  Curr Version Total: \u20b9${Number(summaryStats.compareTotal.toFixed(2)).toLocaleString('en-IN')}  |  Cost Difference: \u20b9${Math.abs(Number(summaryStats.costDifference.toFixed(2))).toLocaleString('en-IN')} ${summaryStats.costDifference > 0 ? '(Increase)' : summaryStats.costDifference < 0 ? '(Decrease)' : ''}`;
        doc.text(summaryLine1, marginX + 20, startY + 5);
        doc.text(summaryLine2, marginX, startY + 10);
        startY += 14;
      }

      const headRows = [
        [{ content: 'Product', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } }, ...selectedColumns.map(c => ({ content: c, colSpan: 2, styles: { halign: 'center' as const } }))],
        [...selectedColumns.flatMap(() => [`V${baseVer?.version_number}`, `V${compVer?.version_number}`])]
      ];

      const bodyRows = comparisonData.map(row => {
        const rowData = [row.name];
        selectedColumns.forEach(col => {
          const isBaseMissing = !row.base;
          const isCompMissing = !row.compare;
          const baseVal = row.base ? (row.base[col] || 0) : 0;
          const compVal = row.compare ? (row.compare[col] || 0) : 0;
          rowData.push(
            isBaseMissing ? "Not Added" : (baseVal !== 0 ? Number(baseVal.toFixed(2)).toLocaleString() : "0"),
            isCompMissing ? "Removed" : (compVal !== 0 ? Number(compVal.toFixed(2)).toLocaleString() : "0")
          );
        });
        return rowData;
      });

      autoTable(doc, {
        head: headRows,
        body: bodyRows,
        startY: startY,
        margin: { left: marginX, right: marginX },
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.3 },
        headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold', lineColor: [0, 0, 0], lineWidth: 0.4 },
        didParseCell: function (data) {
          if (data.section === 'body') {
            if (data.column.index > 0) {
              data.cell.styles.halign = 'right' as const;
            }
            const rowData = comparisonData[data.row.index];
            if (rowData) {
              // Row coloring for added/deleted items
              if (!rowData.base) {
                data.cell.styles.fillColor = [220, 252, 231]; // green-100
              } else if (!rowData.compare) {
                data.cell.styles.fillColor = [254, 226, 226]; // red-100
              }
              // Value-level coloring for modified items
              if (data.column.index > 0) {
                const colIdx = Math.floor((data.column.index - 1) / 2);
                if (colIdx >= 0 && colIdx < selectedColumns.length) {
                  const colName = selectedColumns[colIdx];
                  const baseVal = rowData.base ? (rowData.base[colName] || 0) : 0;
                  const compVal = rowData.compare ? (rowData.compare[colName] || 0) : 0;
                  if (Math.abs(baseVal - compVal) > 0.01) {
                    const isBaseCol = (data.column.index - 1) % 2 === 0;
                    if (!isBaseCol) {
                      data.cell.styles.textColor = compVal > baseVal ? [220, 38, 38] : [22, 163, 74];
                    }
                  }
                }
              }
            }
          }
        }
      });

      doc.save(`Comparison_${selProj?.name}_V${baseVer?.version_number}_vs_V${compVer?.version_number}.pdf`);
      toast({ title: "Success", description: "Comparison PDF downloaded" });
    } catch (e) {
      console.error(e);
      toast({ title: "Error", description: "Failed to generate PDF", variant: "destructive" });
    }
  };

  const handleDownloadExcel = () => {
    try {
      const selProj = projects.find(p => p.id === selectedProjectId);
      const baseVer = versions.find(v => v.id === baseVersionId);
      const compVer = versions.find(v => v.id === selectedVersionId);
      
      const wsData: any[][] = [];
      
      wsData.push(["Version Comparison Report"]);
      wsData.push([`Project:`, selProj?.name || "-"]);
      wsData.push([`Compared Versions:`, `V${baseVer?.version_number} vs V${compVer?.version_number}`]);
      wsData.push([`Date:`, new Date().toLocaleDateString()]);
      wsData.push([]);

      // Summary
      if (summaryStats) {
        wsData.push(["Comparison Summary"]);
        wsData.push(["Total Items", summaryStats.total]);
        wsData.push(["Added", summaryStats.added]);
        wsData.push(["Deleted", summaryStats.removed]);
        wsData.push(["Modified", summaryStats.modified]);
        wsData.push(["Previous Version Total", summaryStats.baseTotal]);
        wsData.push(["Current Version Total", summaryStats.compareTotal]);
        wsData.push(["Cost Difference", summaryStats.costDifference]);
        wsData.push([]);
      }

      // Headers
      const head1 = ["Product"];
      const head2 = [""];
      selectedColumns.forEach(c => {
        head1.push(c, "");
        head2.push(`V${baseVer?.version_number}`, `V${compVer?.version_number}`);
      });
      wsData.push(head1);
      wsData.push(head2);

      // Data
      comparisonData.forEach(row => {
        const rowData: any[] = [row.name];
        selectedColumns.forEach(col => {
          const isBaseMissing = !row.base;
          const isCompMissing = !row.compare;
          const baseVal = row.base ? (row.base[col] || 0) : 0;
          const compVal = row.compare ? (row.compare[col] || 0) : 0;
          
          rowData.push(
            isBaseMissing ? "Not Added" : baseVal,
            isCompMissing ? "Removed" : compVal
          );
        });
        wsData.push(rowData);
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, "Comparison");
      XLSX.writeFile(wb, `Comparison_${selProj?.name}_V${baseVer?.version_number}_vs_V${compVer?.version_number}.xlsx`);
      toast({ title: "Success", description: "Comparison Excel downloaded" });
    } catch (e) {
      console.error(e);
      toast({ title: "Error", description: "Failed to generate Excel", variant: "destructive" });
    }
  };

  const getBaseVersionNumber = () => versions.find(v => v.id === baseVersionId)?.version_number || "?";
  const getCompVersionNumber = () => versions.find(v => v.id === selectedVersionId)?.version_number || "?";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] w-screen max-h-[100vh] h-screen m-0 p-0 rounded-none border-none flex flex-col overflow-hidden" style={{ background: "#f8f9fb" }}>

        {/* Header */}
        <DialogHeader className="px-6 py-3.5 border-b bg-white flex-shrink-0" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-indigo-50 flex items-center justify-center">
                <Scale className="h-4 w-4 text-indigo-500" />
              </div>
              <DialogTitle className="text-base font-semibold text-slate-800 tracking-tight">Compare Versions</DialogTitle>
            </div>
            <div className="flex items-center gap-2 mr-8">
              {showComparison && (
                <>
                  <Button
                    onClick={handleDownloadPdf}
                    size="sm"
                    className="h-8 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 transition-colors px-3 gap-1.5 rounded-md"
                  >
                    <Download className="h-3.5 w-3.5" /> Export PDF
                  </Button>
                  <Button
                    onClick={handleDownloadExcel}
                    size="sm"
                    className="h-8 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 transition-colors px-3 gap-1.5 rounded-md"
                  >
                    <Download className="h-3.5 w-3.5" /> Export Excel
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">

          {/* Config Panel */}
          <div className="bg-white border-b px-6 py-4 flex-shrink-0" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            {!showComparison ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Project</Label>
                  <Select value={selectedProjectId} onValueChange={(v) => { setSelectedProjectId(v); setBaseVersionId(""); setSelectedVersionId(""); }}>
                    <SelectTrigger className="bg-slate-50 border-slate-200 h-9 text-sm">
                      <SelectValue placeholder="Select Project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Base Version</Label>
                  <Select value={baseVersionId} onValueChange={setBaseVersionId} disabled={!selectedProjectId || loading}>
                    <SelectTrigger className="bg-slate-50 border-slate-200 h-9 text-sm">
                      <SelectValue placeholder={loading ? "Loading…" : "Select Base"} />
                    </SelectTrigger>
                    <SelectContent>
                      {versions.map(v => (
                        <SelectItem key={v.id} value={v.id}>
                          V{v.version_number} ({v.type.toUpperCase()}) — {v.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-center pb-2">
                  <div className="h-8 w-8 rounded-full border border-slate-200 bg-slate-50 flex items-center justify-center">
                    <ArrowRightLeft className="text-slate-400 h-3.5 w-3.5" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Compare With</Label>
                  <Select value={selectedVersionId} onValueChange={setSelectedVersionId} disabled={!selectedProjectId || loading}>
                    <SelectTrigger className="bg-slate-50 border-slate-200 h-9 text-sm">
                      <SelectValue placeholder={loading ? "Loading…" : "Select Target"} />
                    </SelectTrigger>
                    <SelectContent>
                      {versions.filter(v => v.id !== baseVersionId).map(v => (
                        <SelectItem key={v.id} value={v.id}>
                          V{v.version_number} ({v.type.toUpperCase()}) — {v.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-4 flex justify-end mt-1">
                  <Button
                    onClick={handleStartComparison}
                    disabled={!baseVersionId || !selectedVersionId || loadingData}
                    size="sm"
                    className="h-8 bg-indigo-600 hover:bg-indigo-700 transition-colors px-4 text-xs font-medium gap-1.5 rounded-md"
                  >
                    {loadingData ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        Loading…
                      </span>
                    ) : (
                      <> Run Comparison <ArrowRight className="h-3.5 w-3.5" /></>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Version badge row */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 text-xs">Comparing</span>
                    <span className="px-2.5 py-0.5 bg-indigo-50 border border-indigo-100 rounded-md text-xs font-semibold text-indigo-700 tabular-nums">
                      V{getBaseVersionNumber()}
                    </span>
                    <ArrowRightLeft className="h-3 w-3 text-slate-300" />
                    <span className="px-2.5 py-0.5 bg-rose-50 border border-rose-100 rounded-md text-xs font-semibold text-rose-700 tabular-nums">
                      V{getCompVersionNumber()}
                    </span>
                    <button
                      onClick={() => setShowComparison(false)}
                      className="ml-2 text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors"
                    >
                      Change
                    </button>
                  </div>

                  {/* Comprehensive Summary Cards */}
                  {summaryStats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 w-full">
                      <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Items Summary</div>
                        <div className="flex gap-2 text-xs">
                          <span className="text-sky-600 font-medium">{summaryStats.added} Added</span>
                          <span className="text-orange-500 font-medium">{summaryStats.removed} Deleted</span>
                          <span className="text-slate-600 font-medium">{summaryStats.modified} Modified</span>
                        </div>
                      </div>
                      
                      <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Prev Version Total</div>
                        <div className="text-sm font-bold text-slate-800 tabular-nums">
                          ₹{Number(summaryStats.baseTotal.toFixed(2)).toLocaleString('en-IN')}
                        </div>
                      </div>
                      
                      <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Curr Version Total</div>
                        <div className="text-sm font-bold text-slate-800 tabular-nums">
                          ₹{Number(summaryStats.compareTotal.toFixed(2)).toLocaleString('en-IN')}
                        </div>
                      </div>
                      
                      <div className={`p-3 rounded-lg border shadow-sm ${summaryStats.costDifference > 0 ? 'bg-red-50 border-red-100' : summaryStats.costDifference < 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'}`}>
                        <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${summaryStats.costDifference > 0 ? 'text-red-500' : summaryStats.costDifference < 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                          Cost Difference
                        </div>
                        <div className={`text-sm font-bold tabular-nums flex items-center gap-1 ${summaryStats.costDifference > 0 ? 'text-red-600' : summaryStats.costDifference < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                          {summaryStats.costDifference > 0 ? <TrendingUp className="h-4 w-4" /> : summaryStats.costDifference < 0 ? <TrendingDown className="h-4 w-4" /> : null}
                          ₹{Math.abs(Number(summaryStats.costDifference.toFixed(2))).toLocaleString('en-IN')}
                          <span className="text-[10px] font-normal opacity-80">
                            {summaryStats.costDifference > 0 ? '(Increase)' : summaryStats.costDifference < 0 ? '(Decrease)' : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Columns selector */}
                <div className="border border-slate-100 rounded-lg bg-slate-50/60">
                  <div
                    className="flex justify-between items-center cursor-pointer px-3 py-2 hover:bg-slate-100/60 rounded-lg transition-colors"
                    onClick={() => setIsColumnsExpanded(!isColumnsExpanded)}
                  >
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                      {isColumnsExpanded
                        ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                        : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                      Columns
                      <span className="ml-1 px-1.5 py-px bg-indigo-100 text-indigo-600 rounded text-[10px] normal-case font-medium">{selectedColumns.length}</span>
                    </span>
                    {selectedColumns.length > 5 && isColumnsExpanded && (
                      <span className="text-[10px] text-slate-400">Scroll right to see all</span>
                    )}
                  </div>

                  {isColumnsExpanded && (
                    <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-1 max-h-[96px] overflow-y-auto">
                      {availableColumns.map(col => {
                        const active = selectedColumns.includes(col);
                        return (
                          <button
                            key={col}
                            onClick={() => setSelectedColumns(prev =>
                              active ? prev.filter(c => c !== col) : [...prev, col]
                            )}
                            className={cn(
                              "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-all",
                              active
                                ? "bg-white border-indigo-200 text-indigo-700 shadow-sm"
                                : "bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                            )}
                          >
                            <span className={cn(
                              "h-1.5 w-1.5 rounded-full transition-colors",
                              active ? "bg-indigo-500" : "bg-slate-300"
                            )} />
                            {col}
                            {active && (
                              <X
                                className="h-2.5 w-2.5 text-slate-400 hover:text-slate-600"
                                onClick={(e) => { e.stopPropagation(); setSelectedColumns(prev => prev.filter(x => x !== col)); }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Comparison Table */}
          {showComparison && (
            <div
              className="flex-1 overflow-auto p-4"
              onScroll={(e) => setScrollPosition(e.currentTarget.scrollLeft)}
            >
              {selectedColumns.length > 0 ? (
                <div className="min-w-max rounded-xl overflow-hidden border border-slate-200 bg-white" style={{ boxShadow: "0 1px 8px rgba(0,0,0,0.06)" }}>
                  <table className="w-full border-collapse text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th
                          rowSpan={2}
                          className="px-4 py-3 border-r border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 sticky left-0 z-20 min-w-[220px]"
                          style={{ boxShadow: "2px 0 6px -2px rgba(0,0,0,0.06)" }}
                        >
                          Item / Product
                        </th>
                        {selectedColumns.map(col => (
                          <th
                            key={col}
                            colSpan={2}
                            className="px-4 py-2.5 border-r border-b border-slate-200 text-xs font-semibold text-center text-slate-600 relative group"
                          >
                            <span>{col}</span>
                            <button
                              onClick={() => setSelectedColumns(prev => prev.filter(c => c !== col))}
                              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </th>
                        ))}
                      </tr>
                      <tr className="border-b-2 border-slate-200 bg-slate-50">
                        {selectedColumns.map(col => (
                          <React.Fragment key={`${col}-sub`}>
                            <th className="px-3 py-1.5 border-r border-slate-100 text-[11px] font-semibold text-indigo-600 text-right bg-indigo-50/40 tabular-nums">
                              V{getBaseVersionNumber()}
                            </th>
                            <th className="px-3 py-1.5 border-r border-slate-200 text-[11px] font-semibold text-rose-600 text-right bg-rose-50/40 tabular-nums">
                              V{getCompVersionNumber()}
                            </th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonData.length === 0 ? (
                        <tr>
                          <td colSpan={selectedColumns.length * 2 + 1} className="p-12 text-center text-slate-400 text-sm">
                            <div className="flex flex-col items-center gap-2">
                              <ArrowRightLeft className="h-8 w-8 text-slate-200" />
                              <span>No matching items found between these versions.</span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        comparisonData.map((row, idx) => (
                          <tr
                            key={idx}
                            className={cn(
                              "border-b transition-colors group/row",
                              !row.base ? "bg-emerald-50/50 hover:bg-emerald-50/80 border-emerald-100" : 
                              !row.compare ? "bg-red-50/50 hover:bg-red-50/80 border-red-100" : 
                              "border-slate-100 hover:bg-slate-50/70"
                            )}
                          >
                            <td
                              className={cn(
                                "px-4 py-2.5 border-r border-slate-100 text-sm text-slate-700 sticky left-0 z-10 transition-colors",
                                !row.base ? "bg-emerald-50/90 group-hover/row:bg-emerald-100/60" : 
                                !row.compare ? "bg-red-50/90 group-hover/row:bg-red-100/60" : 
                                "bg-white group-hover/row:bg-slate-50/70"
                              )}
                              style={{ boxShadow: "2px 0 6px -2px rgba(0,0,0,0.04)" }}
                            >
                              {row.name}
                            </td>
                            {selectedColumns.map(col => {
                              const isBaseMissing = !row.base;
                              const isCompMissing = !row.compare;
                              const baseVal = row.base ? (row.base[col] || 0) : 0;
                              const compVal = row.compare ? (row.compare[col] || 0) : 0;
                              const diff = compVal - baseVal;
                              const hasDiff = !isBaseMissing && !isCompMissing && Math.abs(diff) > 0.01;

                              return (
                                <React.Fragment key={`${row.name}-${col}`}>
                                  <td className="px-3 py-2.5 border-r border-slate-100 text-right text-slate-500 text-xs tabular-nums">
                                    {isBaseMissing ? (
                                      <span className="text-[9px] font-bold uppercase text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded tracking-tighter">NEW</span>
                                    ) : baseVal !== 0 ? Number(baseVal.toFixed(2)).toLocaleString() : (
                                      <span className="text-slate-300">0</span>
                                    )}
                                  </td>
                                  <td className={cn(
                                    "px-3 py-2.5 border-r border-slate-100 text-right text-xs tabular-nums font-medium relative",
                                    isCompMissing ? "text-slate-300 bg-slate-50/50" :
                                      hasDiff && diff > 0 ? "text-red-500 bg-red-50/40" :
                                        hasDiff && diff < 0 ? "text-emerald-600 bg-emerald-50/40" : "text-slate-600"
                                  )}>
                                    {isCompMissing ? (
                                      <span className="text-[10px] font-medium text-orange-400 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100">removed</span>
                                    ) : (
                                      <>
                                        {compVal !== 0 ? Number(compVal.toFixed(2)).toLocaleString() : <span className="text-slate-300">0</span>}
                                        {hasDiff && (
                                          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] opacity-60">
                                            {diff > 0 ? "↑" : "↓"}
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </td>
                                </React.Fragment>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center space-y-2 text-slate-400">
                    <ArrowRightLeft className="h-10 w-10 mx-auto text-slate-200" />
                    <p className="text-sm">Select columns above to compare</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
