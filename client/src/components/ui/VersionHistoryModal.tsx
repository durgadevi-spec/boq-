import React, { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { History, Clock, User, FileText, Plus, Trash2, Download, ArrowRightLeft, Maximize2, Minimize2, Pencil, Check, X } from "lucide-react";
import { format } from "date-fns";
import apiFetch from "@/lib/api";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface VersionHistoryModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string | null;
  projectId?: string | null;
  onCompareClick?: () => void;
  boqItems?: any[];
  isAdmin?: boolean;
  projectName?: string;
  clientName?: string;
}

export function VersionHistoryModal({ isOpen, onOpenChange, versionId, projectId, onCompareClick, boqItems = [], isAdmin = false, projectName, clientName }: VersionHistoryModalProps) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'current' | 'all'>('current');
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string | number>>(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
      setSelectedHistoryIds(new Set());
    }
  }, [isOpen, versionId, projectId, viewMode, boqItems]);

  const fetchHistory = async () => {
    if (viewMode === 'current' && !versionId) return;
    if (viewMode === 'all' && !projectId) return;

    setLoading(true);
    try {
      const url = viewMode === 'all' 
        ? `/api/boq-projects/${projectId}/all-history`
        : `/api/boq-versions/${versionId}/history`;
        
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        const filteredHistory = (data.history || []).filter((entry: any) => {
          const action = (entry.action || '').toLowerCase();
          // Exclude version-level status actions (these are not item changes)
          const versionLevelActions = ['approved', 'pending_approval', 'rejected', 'edited', 'locked', 'edit_requested', 'edit_rejected', 'edit_approved'];
          if (versionLevelActions.includes(action)) return false;
          // Also exclude any entry with no item_id and no item_name (these are status-only logs)
          if (!entry.item_id && (!entry.item_name || entry.item_name === 'Unknown Item' || entry.item_name === 'Unnamed Item')) return false;
          return true;
        }).map((entry: any) => {
          let itemName = entry.item_name;
          if (!itemName || itemName === 'Unknown Item' || itemName === 'Unnamed Item') {
             if (boqItems.length > 0 && entry.item_id) {
               const item = boqItems.find((i: any) => i.id === entry.item_id);
               if (item) {
                 let td = item.table_data;
                 if (typeof td === 'string') {
                   try { td = JSON.parse(td); } catch (e) {}
                 }
                 td = td || {};
                 itemName = td.product_name || td.item || td.name || td.category_name || item.estimator || 'Unknown Item';
               }
             }
          }
          return { ...entry, item_name: itemName };
        });
        setHistory(filteredHistory);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!history || history.length === 0) return;
    
    const itemsToDownload = selectedHistoryIds.size > 0 
      ? history.filter((entry, idx) => selectedHistoryIds.has(entry.id || idx))
      : history;
      
    if (selectedHistoryIds.size === 0) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 10;
    const headerBoxY = 8;
    const headerBoxH = 28;
    const subtitleH = 12; // space for subtitle row
    const totalHeaderH = headerBoxH + subtitleH;

    // Draw header box — top line
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    const boxRight = pageWidth - marginX;
    const boxBottom = headerBoxY + headerBoxH;
    const tableStartY = headerBoxY + totalHeaderH;
    doc.line(marginX, headerBoxY, boxRight, headerBoxY);
    // Left line extends through subtitle area to table
    doc.line(marginX, headerBoxY, marginX, tableStartY);
    // Right line extends through subtitle area to table
    doc.line(boxRight, headerBoxY, boxRight, tableStartY);
    // Separator line between header and subtitle
    doc.setLineWidth(0.3);
    doc.line(marginX, boxBottom, boxRight, boxBottom);

    // Fetch and add logo
    let logoDataUrl: string | null = null;
    try {
      const r = await fetch("/image.png");
      if (r.ok) {
        const b = await r.blob();
        logoDataUrl = await new Promise(res => {
          const reader = new FileReader();
          reader.onloadend = () => res(reader.result as string);
          reader.onerror = () => res(null);
          reader.readAsDataURL(b);
        });
      }
    } catch (err) {
      console.warn("Logo fetch failed", err);
    }

    if (logoDataUrl) {
      try {
        const imgProps: any = doc.getImageProperties(logoDataUrl);
        const imgH = 22;
        const imgW = (imgProps.width / imgProps.height) * imgH;
        doc.addImage(logoDataUrl, "PNG", marginX + 2, headerBoxY + 3, imgW, imgH);
      } catch (e) { console.error("Logo error", e); }
    }

    // Centered title
    doc.setFontSize(15);
    doc.setFont("helvetica", "bold");
    doc.text("CONCEPT TRUNK INTERIORS", pageWidth / 2, headerBoxY + 13, { align: "center" });

    // Project info on right
    const metaX = pageWidth - marginX - 2;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(`Project: ${projectName || "BOM"}`, metaX, headerBoxY + 7, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.text(`Client: ${clientName || "-"}`, metaX, headerBoxY + 13, { align: "right" });
    doc.text(`Date: ${new Date().toLocaleDateString()}`, metaX, headerBoxY + 19, { align: "right" });

    // Sub-title inside the extended box area
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(viewMode === 'all' ? "All Versions History Log" : "Version History Log", pageWidth / 2, boxBottom + 8, { align: "center" });
    
    const head = viewMode === 'all' 
      ? [["Version", "Date", "User", "Action", "Item Name", "Reason"]]
      : [["Date", "User", "Action", "Item Name", "Reason"]];
      
    const body = itemsToDownload.map(entry => {
      const row = [
        format(new Date(entry.created_at), 'MMM d, yyyy h:mm a'),
        entry.user_full_name || 'System User',
        entry.action,
        entry.item_name || 'Unknown Item',
        entry.reason || '-'
      ];
      if (viewMode === 'all') {
        row.unshift(`V${entry.version_number}`);
      }
      return row;
    });
    
    const tableAvailW = pageWidth - (marginX * 2);

    // Column widths for proper alignment
    const colWidths: any = viewMode === 'all'
      ? { 0: { cellWidth: 14 }, 1: { cellWidth: 30 }, 2: { cellWidth: 28 }, 3: { cellWidth: 18 }, 4: { cellWidth: 'auto' }, 5: { cellWidth: 'auto' } }
      : { 0: { cellWidth: 32 }, 1: { cellWidth: 30 }, 2: { cellWidth: 20 }, 3: { cellWidth: 'auto' }, 4: { cellWidth: 'auto' } };

    autoTable(doc, {
      startY: tableStartY,
      margin: { left: marginX, right: marginX },
      tableWidth: tableAvailW,
      head,
      body,
      theme: "grid",
      styles: {
        fontSize: 9,
        lineColor: [0, 0, 0],
        lineWidth: 0.3,
        overflow: 'linebreak',
        cellPadding: 2,
      },
      headStyles: {
        fillColor: [40, 40, 40],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        lineColor: [0, 0, 0],
        lineWidth: 0.4,
        fontSize: 9,
      },
      bodyStyles: {
        lineColor: [0, 0, 0],
        lineWidth: 0.3,
        minCellHeight: 8,
      },
      columnStyles: colWidths,
      tableLineColor: [0, 0, 0],
      tableLineWidth: 0.5,
    });
    
    doc.save(`Version_History_${viewMode === 'all' ? 'All' : versionId || 'Export'}.pdf`);
  };

  // Group history by version_number if in "all" mode
  const groupedHistory = useMemo(() => {
    if (viewMode === 'current') return null;
    const groups: Record<number, any[]> = {};
    history.forEach(entry => {
      const vNum = entry.version_number || 0;
      if (!groups[vNum]) groups[vNum] = [];
      groups[vNum].push(entry);
    });
    // sort versions descending
    return Object.entries(groups).sort((a, b) => Number(b[0]) - Number(a[0]));
  }, [history, viewMode]);

  const saveReason = async (entryId: string) => {
    setSavingId(entryId);
    try {
      const res = await apiFetch(`/api/boq-history/${entryId}/reason`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: editReason }),
      });
      if (res.ok) {
        setHistory(prev => prev.map(h => h.id === entryId ? { ...h, reason: editReason } : h));
        setEditingId(null);
      } else {
        const err = await res.json();
        alert(err.message || 'Failed to save reason');
      }
    } catch (e) {
      alert('Failed to save reason');
    } finally {
      setSavingId(null);
    }
  };

  const renderHistoryEntry = (entry: any, idx: number) => (
    <div key={entry.id || idx} className="flex gap-4 p-3 rounded-lg border border-slate-100 bg-white shadow-sm">
      <div className="shrink-0 mt-1 flex flex-col items-center gap-2">
        <input 
          type="checkbox" 
          className="w-4 h-4 cursor-pointer accent-blue-600 rounded"
          checked={selectedHistoryIds.has(entry.id || idx)}
          onChange={(e) => {
            const next = new Set(selectedHistoryIds);
            if (e.target.checked) next.add(entry.id || idx);
            else next.delete(entry.id || idx);
            setSelectedHistoryIds(next);
          }}
        />
        {entry.action === 'ADDED' ? (
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600">
            <Plus className="h-4 w-4" />
          </div>
        ) : entry.action === 'DELETED' ? (
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600">
            <Trash2 className="h-4 w-4" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600">
            <FileText className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-start justify-between">
          <div>
            <span className="font-bold text-slate-800 text-sm">
              {entry.action === 'ADDED' ? 'Added Item: ' : entry.action === 'DELETED' ? 'Deleted Item: ' : ''}
            </span>
            <span className="text-sm text-slate-600">{entry.item_name || 'Unknown Item'}</span>
          </div>
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {format(new Date(entry.created_at), 'MMM d, yyyy h:mm a')}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[12px] text-slate-500">
          <User className="h-3 w-3" />
          {entry.user_full_name || 'System User'}
        </div>
        {editingId === entry.id ? (
          <div className="mt-2 space-y-2">
            <textarea
              autoFocus
              className="w-full text-[12px] text-slate-700 p-2 border border-blue-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              rows={3}
              value={editReason}
              onChange={e => setEditReason(e.target.value)}
              placeholder="Enter reason..."
            />
            <div className="flex gap-2">
              <button
                onClick={() => saveReason(entry.id)}
                disabled={savingId === entry.id}
                className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white text-[11px] font-semibold rounded-md hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                <Check className="h-3 w-3" />
                {savingId === entry.id ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-md hover:bg-slate-200 transition-colors"
              >
                <X className="h-3 w-3" />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 group/reason flex items-start gap-2">
            <div className={`flex-1 p-2 rounded border text-[12px] text-slate-700 ${
              entry.reason ? 'bg-slate-50 border-slate-200' : 'bg-slate-50/50 border-dashed border-slate-200 text-slate-400'
            }`}>
              {entry.reason ? (
                <><span className="font-semibold text-slate-600">Reason:</span> {entry.reason}</>
              ) : (
                isAdmin ? <span className="italic">No reason — click ✏️ to add one</span> : null
              )}
            </div>
            {isAdmin && (
              <button
                onClick={() => { setEditingId(entry.id); setEditReason(entry.reason || ''); }}
                className="mt-1 p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors opacity-0 group-hover/reason:opacity-100"
                title="Edit reason"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderHistoryColumns = () => {
    return (
      <div className="flex-1 min-h-0 overflow-auto bg-slate-100/50 p-2 sm:p-4 rounded-lg relative custom-scrollbar border border-slate-200 mx-1 mb-2">
        <div className="flex gap-4 items-start w-max min-w-full">
          {groupedHistory?.map(([vNum, entries]) => (
            <div key={vNum} className="w-[320px] sm:w-[360px] flex-shrink-0 flex flex-col border border-slate-200 rounded-xl bg-slate-50 shadow-sm overflow-hidden h-fit">
              <div className="bg-white px-4 py-3 border-b border-slate-200 flex items-center justify-between sticky top-0 z-10 shadow-[0_2px_4px_-2px_rgba(0,0,0,0.05)]">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <div className="bg-blue-100 text-blue-700 px-2.5 py-1 rounded-md text-xs tracking-wide">VERSION {vNum}</div>
                </h3>
                <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{entries.length} changes</span>
              </div>
              <div className="p-3 space-y-3">
                {entries.map((entry, idx) => renderHistoryEntry(entry, idx))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={`bg-white border-slate-200 flex flex-col overflow-hidden transition-all duration-200 ${
        isFullscreen ? "max-w-[98vw] w-[98vw] h-[98vh] max-h-[98vh]" : "max-w-6xl max-h-[85vh]"
      }`}>
        <DialogHeader className="flex flex-row items-start justify-between pr-10 border-b pb-4 shrink-0">
          <div>
            <DialogTitle className="flex items-center gap-2 text-slate-800">
              <History className="h-5 w-5 text-blue-500" />
              {viewMode === 'all' ? 'All Versions History' : 'Version History'}
            </DialogTitle>
            <DialogDescription className="text-slate-500 mt-1">
              {viewMode === 'all' ? 'Activity and item changes across all versions of the project.' : 'Activity and item changes for this version.'}
            </DialogDescription>
          </div>
          <div className="flex gap-2 items-center">
            {onCompareClick && (
              <Button
                variant="outline"
                size="sm"
                onClick={onCompareClick}
                className="flex items-center gap-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
              >
                <ArrowRightLeft className="h-4 w-4" />
                Detailed Comparison
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={loading || history.length === 0 || selectedHistoryIds.size === 0}
              className="flex items-center gap-2 text-blue-600 border-blue-200 hover:bg-blue-50"
            >
              <Download className="h-4 w-4" />
              Download Selected ({selectedHistoryIds.size})
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="h-8 w-8 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
              title={isFullscreen ? "Restore" : "Maximize"}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </DialogHeader>
        
        {projectId && (
          <div className="flex space-x-1 p-1 bg-slate-100 rounded-lg mx-1 mt-2 shrink-0">
            <button
              onClick={() => setViewMode('current')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'current' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Current Version
            </button>
            <button
              onClick={() => setViewMode('all')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              All Versions
            </button>
          </div>
        )}

        {!loading && history.length > 0 && viewMode === 'current' && (
          <div className="flex items-center gap-2 px-3 py-2 mt-2 bg-slate-50 border border-slate-200 rounded-lg mx-1 shrink-0">
            <input 
              type="checkbox" 
              className="w-4 h-4 cursor-pointer accent-blue-600 rounded"
              checked={selectedHistoryIds.size === history.length && history.length > 0}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedHistoryIds(new Set(history.map((entry, idx) => entry.id || idx)));
                } else {
                  setSelectedHistoryIds(new Set());
                }
              }}
            />
            <span className="text-sm font-semibold text-slate-700">Select All</span>
          </div>
        )}
        
        {loading ? (
          <div className="text-center text-slate-500 py-8 w-full flex-1">Loading history...</div>
        ) : history.length === 0 ? (
          <div className="text-center text-slate-500 py-8 w-full flex-1">No history recorded yet.</div>
        ) : viewMode === 'all' ? (
          renderHistoryColumns()
        ) : (
          <div className="py-2 overflow-y-auto space-y-4 pr-2 mx-1 mb-2 flex-1 min-h-0">
            {history.map((entry, idx) => renderHistoryEntry(entry, idx))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
