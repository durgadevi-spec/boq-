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

export function VersionStatusBanner({ version }: { version: BOMVersion }) {
  if (version.status === "submitted") return (
    <div className="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm text-yellow-800 flex items-center gap-2">
      <Lock className="h-4 w-4" /><div><strong>Version Locked.</strong> This version is locked from further edits.</div>
    </div>
  );
  if (version.status === "pending_approval") return (
    <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-800 flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /><div><strong>Pending Approval.</strong> This version is being reviewed by admin.</div>
    </div>
  );
  if (version.status === "approved") {
    return (
      <div className="bg-green-50 border border-green-200 rounded p-4 text-sm text-green-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <div><strong>Approved!</strong> This version has been approved. You can now use the "Generate PO" page to create purchase orders.</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="bg-white border-green-200 text-green-700 hover:bg-green-100 h-8 font-bold"
          onClick={async () => {
            if (confirm("Are you sure you want to request approval to edit this BOM?")) {
              try {
                const res = await apiFetch(`/api/boq-versions/${version.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "edit_requested" })
                });
                if (res.ok) {
                  window.location.reload(); // Simplest way to refresh state
                }
              } catch (err) {
                console.error("Failed to request edit:", err);
              }
            }
          }}
        >
          Request to Edit
        </Button>
      </div>
    );
  }
  if (version.status === "edit_requested") return (
    <div className="bg-indigo-50 border border-indigo-200 rounded p-4 text-sm text-indigo-800 flex items-center gap-2">
      <Clock className="h-4 w-4" /><div><strong>Edit Requested.</strong> Waiting for admin approval to edit this version.</div>
    </div>
  );
  if (version.status === "rejected") return (
    <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-800 space-y-1">
      <div className="flex items-center gap-2"><XCircle className="h-4 w-4" /><strong>Rejected.</strong> This version was rejected.</div>
      {version.rejection_reason && <p className="italic">Reason: {version.rejection_reason}</p>}
      <p className="text-xs font-semibold underline text-blue-700">You can now edit this version and resubmit it for approval.</p>
    </div>
  );
  return null;
}
