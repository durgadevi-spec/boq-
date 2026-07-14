import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ChevronUp, ChevronDown, Loader2, CheckCircle2, XCircle, Lock, History, Clock, Briefcase, MapPin, IndianRupee, GripVertical, Search, ArrowUp, ArrowLeft, ArrowRight, ArrowDown, Plus, Trash2, Save, MessageSquare, Users, ChevronsUpDown, Check, X, RefreshCw, Star, Edit, Reply, AlertTriangle } from "lucide-react";
import { fuzzySearch, cn } from "@/lib/utils";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import apiFetch from "@/lib/api";
import { computeBoq, UnitType } from "@/lib/boqCalc";
import { getEstimatorTypeFromProduct } from "@/lib/estimatorUtils";
import ProductPicker from "@/components/ProductPicker";
import MaterialPicker from "@/components/MaterialPicker";
import Step11Preview from "@/components/Step11Preview";
import { BomSketchCompareDialog } from "@/components/BomSketchCompareDialog";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from 'xlsx';
import { DeleteConfirmationDialog } from "../../../components/ui/DeleteConfirmationDialog";
import { ProductAnalysisDialog } from "@/components/ProductAnalysisDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../../../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Textarea } from "../../../components/ui/textarea";
import { Checkbox } from "../../../components/ui/checkbox";
import { useData } from "../../../lib/store";
import { Project, BOMVersion, BOMItem, Product, Step11Item, BOMHistory, BOMComment, User, PROJECT_STATUSES, getProjectStatusMeta } from '../types';
import { parseTableData, parseImages, safeJson, VERSION_LABEL } from '../utils';

export function ApprovalsList({
  approvals,
  rateChangeRequests = [],
  onPreview,
  onAction,
  onRateAction,
  actionLoading
}: {
  approvals: any[],
  rateChangeRequests?: any[],
  onPreview: (a: any) => void,
  onAction: (id: string, action: 'approve' | 'reject' | 'approve-edit' | 'reject-edit') => void,
  onRateAction?: (id: string, action: 'approve' | 'reject') => void,
  actionLoading: string | null
}) {
  const [listType, setListType] = React.useState("bom");

  const pending = approvals.filter(a => a.status === 'pending_approval' || a.status === 'submitted');
  const editRequests = approvals.filter(a => a.status === 'edit_requested');
  const rateRequests = rateChangeRequests.filter(r => r.status === 'pending');
  const others = approvals.filter(a => a.status !== 'pending_approval' && a.status !== 'submitted' && a.status !== 'edit_requested');

  const currentList = listType === "bom" ? pending : listType === "edit" ? editRequests : listType === "rates" ? rateRequests : others;

  return (
    <div className="space-y-4">
      <div className="flex justify-center mb-6">
        <Tabs value={listType} onValueChange={setListType} className="w-fit">
          <TabsList className="bg-slate-100/80 p-1 border border-slate-200">
            <TabsTrigger
              value="edit"
              className="px-8 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm"
            >
              Edit Requests
              {editRequests.length > 0 && <Badge variant="secondary" className="ml-2 bg-slate-200 text-slate-700">{editRequests.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger
              value="bom"
              className="px-8 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm"
            >
              BOM Approvals
              {pending.length > 0 && <Badge variant="secondary" className="ml-2 bg-blue-100 text-blue-600">{pending.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger
              value="rates"
              className="px-8 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm"
            >
              Rate Changes
              {rateRequests.length > 0 && <Badge variant="secondary" className="ml-2 bg-orange-100 text-orange-600">{rateRequests.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="px-8 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm"
            >
              History
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm ring-1 ring-slate-900/5">
        <Table>
          <TableHeader className="bg-slate-50/80">
            <TableRow className="hover:bg-transparent border-b-slate-200">
              <TableHead className="w-12 text-center text-[10px] font-bold text-slate-400">
                <div className="flex items-center justify-center"><ChevronDown className="h-3 w-3" /></div>
              </TableHead>
              <TableHead className="w-10 px-0">
                <div className="w-4 h-4 border border-slate-300 rounded bg-slate-50/50"></div>
              </TableHead>
              <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 py-4">Project</TableHead>
              <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{listType === 'rates' ? 'Item Details' : 'Client'}</TableHead>
              <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">Version</TableHead>
              <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">Type</TableHead>
              <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">Status</TableHead>
              <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Date</TableHead>
              <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500 text-right pr-8">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-24 text-center">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <div className="p-4 bg-slate-50 rounded-full">
                      <CheckCircle2 className="h-10 w-10 text-slate-200" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-bold text-slate-600">No {listType === 'history' ? 'approval history' : listType === 'bom' ? 'pending BOM approvals' : listType === 'rates' ? 'rate change requests' : 'edit requests'}</p>
                      <p className="text-sm text-slate-400">You're all caught up for now.</p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (

              listType === "rates" ? (
                currentList.map((r) => (
                  <TableRow key={r.id} className="hover:bg-slate-50/50 transition-colors border-b-slate-100">
                    <TableCell className="w-12 py-4"></TableCell>
                    <TableCell className="w-10 px-0">
                      <div className="w-4 h-4 border border-slate-200 rounded hover:border-blue-400 transition-colors"></div>
                    </TableCell>
                    <TableCell className="font-bold text-slate-900 text-sm py-4">{r.project_name || "Unknown Project"}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-800">{r.product_name}</span>
                        <span className="text-xs text-slate-500 italic">{r.material_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-bold text-slate-500 text-xs">V{r.version_number ?? r.version_id.substring(0,6)}</TableCell>
                    <TableCell className="text-center py-4">
                      <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-100 font-bold px-2 py-0 text-[10px] h-5">Rate Amend</Badge>
                    </TableCell>
                    <TableCell className="text-center py-4">
                      <div className="flex flex-col gap-1 items-center">
                        <span className="text-xs text-slate-500 line-through">₹{r.original_rate}</span>
                        <span className="text-sm font-bold text-slate-900">₹{r.requested_rate}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right pr-8 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          className="h-8 text-xs font-bold bg-green-600 hover:bg-green-700 text-white shadow-sm px-4"
                          onClick={() => onRateAction && onRateAction(r.id, 'approve')}
                          disabled={!!actionLoading}
                        >
                          {actionLoading === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Approve"}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-8 text-xs font-bold bg-red-500 hover:bg-red-600 text-white shadow-sm px-4 border-none"
                          onClick={() => onRateAction && onRateAction(r.id, 'reject')}
                          disabled={!!actionLoading}
                        >
                          {actionLoading === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reject"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
              currentList.map((a) => (
                <TableRow key={a.id} className="hover:bg-slate-50/50 transition-colors border-b-slate-100">
                  <TableCell className="w-12 py-4">
                    <button
                      className="flex items-center justify-center w-full text-slate-400 hover:text-blue-600 transition-colors"
                      onClick={() => onPreview(a)}
                      title="Expand View"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </TableCell>
                  <TableCell className="w-10 px-0">
                    <div className="w-4 h-4 border border-slate-200 rounded hover:border-blue-400 transition-colors"></div>
                  </TableCell>
                  <TableCell className="font-bold text-slate-900 text-sm py-4">{a.project_name}</TableCell>
                  <TableCell className="text-sm text-slate-600 italic font-medium">{a.project_client}</TableCell>
                  <TableCell className="text-center font-bold text-slate-500 text-xs">V{a.version_number}</TableCell>
                  <TableCell className="text-center py-4">
                    <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-100 font-bold px-2 py-0 text-[10px] h-5">BOM</Badge>
                  </TableCell>
                  <TableCell className="text-center py-4">
                    {a.status === 'edit_requested' ? (
                      <Badge className="bg-amber-50 text-amber-600 border-amber-100 font-bold text-[10px] h-6 px-3">Edit Requested</Badge>
                    ) : a.status === 'approved' ? (
                      <Badge className="bg-emerald-50 text-emerald-600 border-emerald-100 font-bold text-[10px] h-6 px-3">Approved</Badge>
                    ) : a.status === 'rejected' ? (
                      <Badge className="bg-rose-50 text-rose-600 border-rose-100 font-bold text-[10px] h-6 px-3">Rejected</Badge>
                    ) : (
                      <Badge className="bg-orange-50 text-orange-600 border-orange-100 font-bold text-[10px] h-6 px-3">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
                    {new Date(a.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right pr-8 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-bold border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300"
                        onClick={() => onPreview(a)}
                      >
                        <Edit className="h-3 w-3 mr-1.5" /> Edit BOM
                      </Button>

                      {(a.status === 'pending_approval' || a.status === 'submitted' || a.status === 'edit_requested') && (
                        <>
                          <Button
                            size="sm"
                            className="h-8 text-xs font-bold bg-green-600 hover:bg-green-700 text-white shadow-sm px-4"
                            onClick={() => onAction(a.id, a.status === 'edit_requested' ? 'approve-edit' : 'approve')}
                            disabled={!!actionLoading}
                          >
                            {actionLoading === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-8 text-xs font-bold bg-red-500 hover:bg-red-600 text-white shadow-sm px-4 border-none"
                            onClick={() => onAction(a.id, a.status === 'edit_requested' ? 'reject-edit' : 'reject')}
                            disabled={!!actionLoading}
                          >
                            {actionLoading === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reject"}
                          </Button>
                        </>
                      )}

                      {/* Add Clear button for approved/rejected if needed, similar to screenshot */}
                      {(a.status === 'approved' || a.status === 'rejected') && (
                        <Button size="sm" variant="ghost" className="h-8 text-xs text-slate-400 hover:text-slate-600">Clear</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}