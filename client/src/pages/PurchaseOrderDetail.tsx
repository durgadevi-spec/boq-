import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Layout } from "@/components/layout/Layout";
import {
    Card,
    CardContent,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Textarea } from "@/components/ui/textarea";
import {
    ChevronLeft,
    Loader2,
    Printer,
    Edit,
    Save,
    X,
    Trash2,
    Download,
    Building2,
    Truck,
    User,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import apiFetch from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import html2pdf from "html2pdf.js";

interface PurchaseOrder {
    id: string;
    po_number: string;
    project_id: string;
    vendor_id: string;
    status: string;
    total_amount: string;
    subtotal?: string;
    tax?: string;
    delivery_date: string | null;
    comments: string | null;
    created_at: string;
    project_name?: string;
    vendor_name?: string;
    vendor_location?: string;
    vendor_phone?: string;
    vendor_phone_code?: string;
    vendor_city?: string;
    vendor_state?: string;
    vendor_country?: string;
    vendor_pincode?: string;
    vendor_gstin?: string;
    vendor_new_location?: string;
    vendor_terms?: string;
    project_client?: string;
    project_location?: string;
    approval_comments?: string | null;
    shipping_address?: string | null;
    payment_terms?: string | null;
    dc_number?: string | null;
    dc_date?: string | null;
    items?: PurchaseOrderItem[];
    version_number?: string;
}

interface PurchaseOrderItem {
    id: string;
    item?: string;
    item_name?: string;
    description: string | null;
    unit: string | null;
    qty: string;
    rate: string;
    amount: string;
    hsn_code?: string;
    sac_code?: string;
    // UI-only refinement fields
    delivery_date?: string;
    budget_qty?: number;
    received_qty?: number;
    tax_rate?: number; // Added for per-item tax selection
}

export default function PurchaseOrderDetail() {
    const { id } = useParams();
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const { user } = useAuth();
    const [po, setPo] = useState<PurchaseOrder | null>(null);
    const [items, setItems] = useState<PurchaseOrderItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [showApprovalDialog, setShowApprovalDialog] = useState(false);
    const [approvalAction, setApprovalAction] = useState<"approve" | "reject">("approve");
    const [isDownloading, setIsDownloading] = useState(false);
    const [isPdfExportDialogOpen, setIsPdfExportDialogOpen] = useState(false);
    const [selectedPdfExportCols, setSelectedPdfExportCols] = useState<string[]>([]);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    const handleDownloadPdfOpenDialog = () => {
        const potentialPdfCols = ["S.No", "Item Details", "Unit", "HSN", "SAC", "Original Qty", "Ordered Qty", "Balance Qty", "Tax %", "Rate", "Amount"];
        const defaultPdfSelection = ["S.No", "Item Details", "Unit", "HSN", "SAC", "Original Qty", "Ordered Qty", "Balance Qty", "Tax %", "Rate", "Amount"];

        try {
            const saved = localStorage.getItem('po_pdf_export_cols');
            if (saved) {
                const parsed: string[] = JSON.parse(saved);
                setSelectedPdfExportCols(parsed.filter(c => potentialPdfCols.includes(c)));
            } else {
                setSelectedPdfExportCols(defaultPdfSelection);
            }
        } catch {
            setSelectedPdfExportCols(defaultPdfSelection);
        }
        setIsPdfExportDialogOpen(true);
    };

    const handleGeneratePdfAutotable = async () => {
        if (!po) return;
        setIsGeneratingPdf(true);
        try {
            localStorage.setItem('po_pdf_export_cols', JSON.stringify(selectedPdfExportCols));

            const doc = new jsPDF({ orientation: "portrait" });
            const pageWidth = doc.internal.pageSize.getWidth();
            const marginX = 10;

            doc.setFontSize(18);
            doc.setFont("helvetica", "bold");
            doc.text("PURCHASE ORDER", pageWidth / 2, 20, { align: "center" });

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            doc.text(`PO Number: ${po.po_number}`, marginX, 35);
            doc.text(`Date: ${new Date(po.created_at).toLocaleDateString()}`, marginX, 40);
            doc.text(`Project: ${po.project_name || "N/A"}`, marginX, 45);
            doc.text(`Vendor: ${po.vendor_name || "N/A"}`, marginX, 50);

            const headers = selectedPdfExportCols;
            const body = items.map((item, idx) => {
                const row: any[] = [];
                if (selectedPdfExportCols.includes("S.No")) row.push(idx + 1);
                if (selectedPdfExportCols.includes("Item")) row.push(item.item || item.item_name || "N/A");
                if (selectedPdfExportCols.includes("Description")) row.push(item.description || "N/A");
                if (selectedPdfExportCols.includes("HSN/SAC")) row.push(item.hsn_code || "N/A");
                if (selectedPdfExportCols.includes("Unit")) row.push(item.unit || "N/A");
                if (selectedPdfExportCols.includes("Qty")) row.push(parseFloat(item.qty).toFixed(2));
                if (selectedPdfExportCols.includes("Rate")) row.push(parseFloat(item.rate).toFixed(2));
                if (selectedPdfExportCols.includes("Total")) row.push(parseFloat(item.amount).toFixed(2));
                return row;
            });

            autoTable(doc, {
                head: [headers],
                body: body,
                startY: 60,
                margin: { left: marginX, right: marginX },
                styles: { fontSize: 9 },
                headStyles: { fillColor: [41, 128, 185], textColor: 255 },
                foot: [[
                    ...Array(Math.max(0, headers.length - 2)).fill(""),
                    "Total Amount",
                    `INR ${parseFloat(po.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                ]],
                footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' }
            });

            doc.save(`PO_${po.po_number}.pdf`);
            setIsPdfExportDialogOpen(false);
            toast({ title: "Success", description: "PDF generated successfully" });
        } catch (error) {
            console.error("PDF generation failed:", error);
            toast({ title: "Error", description: "Failed to generate PDF", variant: "destructive" });
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const handleDownloadPDF = (selectedCols?: string[]) => {
        const element = document.getElementById("po-detail-content");
        if (!element) return;

        setIsDownloading(true);

        const potentialPdfCols = ["S.No", "Item Details", "Unit", "HSN", "SAC", "Original Qty", "Ordered Qty", "Balance Qty", "Tax %", "Rate", "Amount"];

        const opt = {
            margin: 5,
            filename: `PO_${po?.po_number || id}.pdf`,
            image: { type: 'jpeg' as const, quality: 1.0 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                logging: false,
                onclone: (clonedDoc: Document) => {
                    clonedDoc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => el.remove());
                    clonedDoc.querySelectorAll('.no-print').forEach(el => el.remove());

                    const clonedDetails = clonedDoc.getElementById('po-detail-content');
                    if (clonedDetails) {
                        clonedDetails.style.width = '794px';
                        clonedDetails.style.maxWidth = '794px';
                        clonedDetails.style.margin = '0';
                        clonedDetails.style.padding = '30px';
                        clonedDetails.style.backgroundColor = 'white';
                        clonedDetails.style.color = '#000000';

                        const card = clonedDetails.querySelector('.Card, .po-container');
                        if (card && card instanceof HTMLElement) {
                            card.style.maxWidth = 'none';
                            card.style.width = '100%';
                            card.style.boxShadow = 'none';
                            card.style.border = 'none';
                        }

                        if (selectedCols && selectedCols.length > 0) {
                            const table = clonedDetails.querySelector('table');
                            if (table) {
                                table.style.width = '100%';
                                table.style.tableLayout = 'auto';

                                const rows = Array.from(table.rows);
                                if (rows.length > 0) {
                                    const headCells = Array.from(rows[0].cells);
                                    const colIndicesToHide: number[] = [];

                                    headCells.forEach((_, idx) => {
                                        if (idx >= potentialPdfCols.length) {
                                            colIndicesToHide.push(idx);
                                            return;
                                        }

                                        const colName = potentialPdfCols[idx];
                                        if (colName && !selectedCols.includes(colName)) {
                                            colIndicesToHide.push(idx);
                                        }
                                    });

                                    rows.forEach(row => {
                                        colIndicesToHide.forEach(idx => {
                                            if (row.cells[idx]) {
                                                row.cells[idx].style.display = 'none';
                                            }
                                        });
                                    });
                                }
                            }
                        }
                    }
                }
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const }
        };

        const clone = element.cloneNode(true) as HTMLElement;
        const sourceElements = [element, ...Array.from(element.querySelectorAll('*'))] as HTMLElement[];
        const cloneElements = [clone, ...Array.from(clone.querySelectorAll('*'))] as HTMLElement[];

        sourceElements.forEach((sEl, i) => {
            const cEl = cloneElements[i];
            if (!cEl) return;

            const isTableCell = sEl.tagName === 'TD' || sEl.tagName === 'TH';
            const style = window.getComputedStyle(sEl);
            const styleProperties = [
                'display', 'position', 'top', 'left', 'right', 'bottom', 
                ...(isTableCell ? [] : ['width', 'height']),
                'padding', 'margin', 'font-size', 'font-family', 'font-weight', 'line-height',
                'color', 'background-color', 'border-color', 'border-width', 'border-style',
                'border-radius', 'flex', 'flex-direction', 'align-items', 'justify-content',
                'text-align', 'box-sizing', 'white-space', 'vertical-align', 'opacity', 'z-index'
            ];

            styleProperties.forEach(prop => {
                let val = style.getPropertyValue(prop);
                if (val && (val.includes('oklch') || val.includes('oklab'))) {
                    if (prop.includes('background')) val = '#ffffff';
                    else if (prop.includes('border')) val = '#cbd5e1';
                    else val = '#000000';
                }
                cEl.style.setProperty(prop, val);
            });
            
            if (isTableCell) {
                cEl.style.width = 'auto';
                cEl.style.height = 'auto';
            }
        });

        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '210mm';
        container.style.zIndex = '-9999';
        container.style.opacity = '0';
        container.style.pointerEvents = 'none';
        container.appendChild(clone);
        document.body.appendChild(container);

        html2pdf().set(opt).from(clone).save().then(() => {
            document.body.removeChild(container);
            setIsDownloading(false);
            toast({
                title: "Success",
                description: "Purchase Order downloaded successfully",
            });
        }).catch((err: any) => {
            console.error("PDF generation error:", err);
            if (container.parentNode) document.body.removeChild(container);
            setIsDownloading(false);
            toast({
                title: "Error",
                description: "Failed to generate PDF. Falling back to print...",
                variant: "destructive"
            });
            // Final fallback: try window.print if everything else fails
            // window.print();
        });
    };
    const [comment, setComment] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Revise Mode States
    const [isReviseMode, setIsReviseMode] = useState(false);
    const [editedItems, setEditedItems] = useState<PurchaseOrderItem[]>([]);
    const [deletedItems, setDeletedItems] = useState<PurchaseOrderItem[]>([]);
    const [showReviseDialog, setShowReviseDialog] = useState(false);
    const [reviseReason, setReviseReason] = useState("");

    // Zoho Books Enhancements UI State
    const [taxPreference, setTaxPreference] = useState<"exclusive" | "inclusive">("exclusive");
    const [shippingAddress, setShippingAddress] = useState("");
    const [paymentTerms, setPaymentTerms] = useState("");
    const [editableDeliveryDate, setEditableDeliveryDate] = useState("");

    const [relatedPos, setRelatedPos] = useState<any[]>([]);
    const [parentItems, setParentItems] = useState<PurchaseOrderItem[]>([]);
    const [showDeleteExistingDialog, setShowDeleteExistingDialog] = useState(false);
    const [existingRevisionToDelete, setExistingRevisionToDelete] = useState<any>(null);
    const [initialItems, setInitialItems] = useState<PurchaseOrderItem[]>([]);

    // General Revise Data
    const [shops, setShops] = useState<any[]>([]);
    const [materials, setMaterials] = useState<any[]>([]);
    const [editableVendorId, setEditableVendorId] = useState<string>("");
    const [itemsAvailability, setItemsAvailability] = useState<Record<string, boolean>>({});

    const searchParams = new URLSearchParams(window.location.search);
    const mode = searchParams.get("mode");

    useEffect(() => {
        if (id) fetchPODetail();
    }, [id]);

    const fetchPODetail = async () => {
        try {
            setLoading(true);
            const res = await apiFetch(`/api/purchase-orders/${id}`);
            if (res.ok) {
                const data = await res.json();
                setPo(data.purchaseOrder);
                setItems(data.items || []);
                setInitialItems(data.items || []);
                setRelatedPos(data.relatedPos || []);
                setParentItems(data.parentItems || []);
                if (data.purchaseOrder.delivery_date) {
                    setEditableDeliveryDate(new Date(data.purchaseOrder.delivery_date).toISOString().split("T")[0]);
                }
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to load Annexure details.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleStatusUpdate = async (newStatus: string) => {
        try {
            const res = await apiFetch(`/api/purchase-orders/${id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
            });
            if (res.ok) {
                toast({ title: "Success", description: `PO status updated to ${newStatus}` });
                fetchPODetail();
            }
        } catch (error) {
            toast({ title: "Error", description: "Failed to update status", variant: "destructive" });
        }
    };

    const handleApproval = async () => {
        setIsSubmitting(true);
        try {
            const res = await apiFetch(`/api/purchase-orders/${id}/approve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    approve: approvalAction === "approve",
                    comment
                }),
            });
            if (res.ok) {
                toast({
                    title: approvalAction === "approve" ? "Approved" : "Rejected",
                    description: `Annexure has been ${approvalAction === "approve" ? "approved" : "rejected"}.`,
                });
                setShowApprovalDialog(false);
                fetchPODetail();
            }
        } catch (error) {
            toast({ title: "Error", description: "Failed to process approval", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReviseClick = () => {
        if (!po) return;
        // Check if there's already a draft or pending revision in the lineage
        // Extraction logic to match the base PO (stripping -R\d+ or -Deferred\d+)
        const baseNumber = po.po_number.replace(/-(R\d+|Deferred\d+)$/, "");
        const existingRevision = relatedPos.find(p =>
            p.id !== po.id &&
            p.po_number.startsWith(baseNumber) &&
            (p.status.toLowerCase() === 'draft' || p.status.toLowerCase() === 'pending_approval')
        );

        if (existingRevision) {
            setExistingRevisionToDelete(existingRevision);
            setShowDeleteExistingDialog(true);
        } else {
            startRevision();
        }
    };

    const startRevision = async () => {
        if (!po) return;

        setIsSubmitting(true);
        try {
            const [shopsRes, materialsRes] = await Promise.all([
                apiFetch('/api/shops'),
                apiFetch('/api/materials')
            ]);
            if (shopsRes.ok) {
                const data = await shopsRes.json();
                setShops(data.shops || []);
            }
            if (materialsRes.ok) {
                const data = await materialsRes.json();
                setMaterials(data.materials || []);
            }
        } catch (error) {
            console.error("Failed to fetch shops/materials for override", error);
        } finally {
            setIsSubmitting(false);
        }

        setIsReviseMode(true);
        setEditedItems(items.map(i => ({ ...i })));
        setDeletedItems([]);
        setEditableVendorId(po.vendor_id);

        // Default availability is true for original items
        const initialAvail: Record<string, boolean> = {};
        for (const item of items) initialAvail[item.id] = true;
        setItemsAvailability(initialAvail);

        // Ensure editable fields are initialized from current PO
        setEditableDeliveryDate(po.delivery_date ? new Date(po.delivery_date).toISOString().split('T')[0] : "");
        setShippingAddress(po.shipping_address || "");
        setPaymentTerms(po.payment_terms || "");
    };

    const confirmDeleteAndRevise = async () => {
        if (!existingRevisionToDelete) return;

        try {
            setIsSubmitting(true);
            const res = await apiFetch(`/api/purchase-orders/${existingRevisionToDelete.id}`, {
                method: "DELETE",
            });

            if (res.ok) {
                toast({
                    title: "Success",
                    description: `Existing revision ${existingRevisionToDelete.po_number} has been deleted.`,
                });
                // Remove from local relatedPos state
                setRelatedPos(prev => prev.filter(p => p.id !== existingRevisionToDelete.id));
                setIsSubmitting(false); // Make sure it's false before async call finishes

                // Now start our revision
                startRevision();
            } else {
                toast({
                    title: "Error",
                    description: "Failed to delete previous revision.",
                    variant: "destructive",
                });
                setIsSubmitting(false);
            }
        } catch (error) {
            toast({ title: "Error", description: "Network error while deleting revision", variant: "destructive" });
            setIsSubmitting(false);
        } finally {
            setShowDeleteExistingDialog(false);
            setExistingRevisionToDelete(null);
        }
    };

    const handleGlobalVendorChange = (newVendorId: string) => {
        setEditableVendorId(newVendorId);

        const shop = shops.find(s => s.id === newVendorId);
        if (!shop) return;

        const newAvailability: Record<string, boolean> = {};
        const newEditedItems = editedItems.map(item => {
            const itemName = item.item || item.item_name;
            const matchedMaterial = materials.find(m =>
                m.shop_id === newVendorId &&
                (m.name === itemName || m.product === itemName || m.item === itemName)
            );

            if (matchedMaterial) {
                newAvailability[item.id] = true;
                const newRate = matchedMaterial.rate;
                const newAmount = parseFloat(item.qty) * newRate;

                return {
                    ...item,
                    rate: newRate.toString(),
                    amount: newAmount.toString()
                };
            } else {
                newAvailability[item.id] = false;
                // Set rate and amount to zero if unavailable in new shop
                return {
                    ...item,
                    rate: "0",
                    amount: "0"
                };
            }
        });

        setItemsAvailability(newAvailability);
        setEditedItems(newEditedItems);
        toast({ title: "Vendor Changed", description: `Rates updated for ${shop.name}` });
    };

    const handleQtyChange = (itemId: string, newQty: string) => {
        setEditedItems(prev => prev.map(i => {
            if (i.id === itemId) {
                const qtyVal = parseFloat(newQty) || 0;
                const rateVal = parseFloat(i.rate) || 0;
                return { ...i, qty: newQty, amount: (qtyVal * rateVal).toString() };
            }
            return i;
        }));
    };

    const handleItemDateChange = (itemId: string, newDate: string) => {
        setEditedItems(prev => prev.map(i => {
            if (i.id === itemId) return { ...i, delivery_date: newDate };
            return i;
        }));
    };

    const handleTaxRateChange = (itemId: string, newRate: string) => {
        setEditedItems(prev => prev.map(i => {
            if (i.id === itemId) return { ...i, tax_rate: parseFloat(newRate) };
            return i;
        }));
    };

    const handleDescriptionChange = (itemId: string, newDesc: string) => {
        setEditedItems(prev => prev.map(i => {
            if (i.id === itemId) return { ...i, description: newDesc };
            return i;
        }));
    };

    const handleDeleteItem = (itemId: string) => {
        const itemToDelete = editedItems.find(i => i.id === itemId);
        if (itemToDelete) {
            setDeletedItems(prev => [...prev, itemToDelete]);
        }
        setEditedItems(prev => prev.filter(i => i.id !== itemId));
    };

    const handleSaveRevisionClick = () => {
        if (editedItems.length === 0) {
            toast({ title: "Error", description: "PO must have at least one item.", variant: "destructive" });
            return;
        }

        if (!editableDeliveryDate) {
            toast({ title: "Error", description: "Expected Delivery date is mandatory.", variant: "destructive" });
            return;
        }

        if (!shippingAddress.trim()) {
            toast({ title: "Error", description: "Deliver To (Shipping Address) is mandatory.", variant: "destructive" });
            return;
        }

        if (!paymentTerms) {
            toast({ title: "Error", description: "Payment Terms are mandatory.", variant: "destructive" });
            return;
        }

        const hasIncrease = editedItems.some(edited => {
            const original = items.find(i => i.id === edited.id);
            if (!original) return false;
            return parseFloat(edited.qty) > parseFloat(original.qty);
        });

        if (hasIncrease) {
            setShowReviseDialog(true);
            setReviseReason("");
        } else {
            submitRevision("");
        }
    };

    const submitRevision = async (reason: string) => {
        setIsSubmitting(true);
        try {
            const selectedShop = shops.find(s => s.id === editableVendorId);
            const res = await apiFetch(`/api/purchase-orders/${id}/revise`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: editedItems,
                    reason,
                    deletedItems,
                    delivery_date: editableDeliveryDate,
                    shippingAddress,
                    paymentTerms,
                    vendor_id: editableVendorId,
                    vendor_name: selectedShop?.name
                }),
            });
            if (res.ok) {
                const data = await res.json();
                toast({ title: "Success", description: "PO Revised successfully." });
                setIsReviseMode(false);
                setShowReviseDialog(false);
                setLocation(`/purchase-orders/${data.newPo.id}`);
            } else {
                toast({ title: "Error", description: "Failed to revise PO", variant: "destructive" });
            }
        } catch (error) {
            toast({ title: "Error", description: "Failed to revise PO", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status.toLowerCase()) {
            case "draft":
                return <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200">Draft</Badge>;
            case "pending_approval":
                return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">Pending Approval</Badge>;
            case "approved":
                return <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200">Approved</Badge>;
            case "rejected":
                return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200">Rejected</Badge>;
            case "ordered":
                return <Badge variant="outline" className="bg-indigo-50 text-indigo-600 border-indigo-200">Ordered</Badge>;
            case "delivered":
                return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200">Delivered</Badge>;
            case "revised":
                return <Badge variant="outline" className="bg-slate-900 text-white border-slate-900 font-bold px-3">REVISED</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    if (loading) {
        return (
            <Layout>
                <div className="flex flex-col items-center justify-center min-h-[60vh]">
                    <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                    <p className="text-muted-foreground">Loading PO details...</p>
                </div>
            </Layout>
        );
    }

    if (!po) {
        return (
            <Layout>
                <div className="text-center py-10">
                    <h2 className="text-xl font-bold">Annexure not found.</h2>
                    <Button variant="link" onClick={() => setLocation("/purchase-orders")}>Go back to list</Button>
                </div>
            </Layout>
        );
    }

    // Calculations
    // Calculations base on current mode
    const displayItems = isReviseMode ? editedItems : items;

    // Improved Per-Item Tax Engine
    let totalTax = 0;
    let baseSubtotal = 0;

    displayItems.forEach(item => {
        const itemAmount = parseFloat(item.amount || "0");
        const rate = item.tax_rate ?? 18; // Default to 18 if not specified

        if (taxPreference === "exclusive") {
            baseSubtotal += itemAmount;
            totalTax += itemAmount * (rate / 100);
        } else {
            // Inclusive
            const base = itemAmount / (1 + (rate / 100));
            baseSubtotal += base;
            totalTax += itemAmount - base;
        }
    });

    const sgst = totalTax / 2;
    const cgst = totalTax / 2;
    const totalWithTax = baseSubtotal + totalTax;
    const grandTotal = Math.round(totalWithTax);
    const displayedSubtotal = baseSubtotal;

    return (
        <Layout>
            <style dangerouslySetInnerHTML={{
                __html: `
                @media print {
                    .no-print { display: none !important; }
                    .print-only { display: block !important; }
                    body { background: white !important; }
                    .main-layout { padding: 0 !important; margin: 0 !important; }
                    .po-container { border: none !important; box-shadow: none !important; width: 100% !important; max-width: 100% !important; }
                    @page { margin: 10mm; size: A4; }
                }
                
                /* FIX: Map oklch/oklab (unsupported by html2pdf/html2canvas) to standard hex colors */
                /* Scoped to #po-detail-content to ensure it doesn't break other parts of the app */
                #po-detail-content, 
                #po-detail-content * {
                    --tw-ring-color: rgba(59, 130, 246, 0.5) !important;
                    --tw-ring-offset-shadow: 0 0 #0000 !important;
                    --tw-ring-shadow: 0 0 #0000 !important;
                    --tw-shadow: 0 0 #0000 !important;
                    --tw-shadow-colored: 0 0 #0000 !important;
                }

                #po-detail-content .text-slate-500 { color: #64748b !important; }
                #po-detail-content .text-slate-600 { color: #475569 !important; }
                #po-detail-content .text-slate-700 { color: #334155 !important; }
                #po-detail-content .text-slate-800 { color: #1e293b !important; }
                #po-detail-content .text-slate-900 { color: #0f172a !important; }
                #po-detail-content .bg-slate-50 { background-color: #f8fafc !important; }
                #po-detail-content .bg-slate-100 { background-color: #f1f5f9 !important; }
                #po-detail-content .bg-slate-200 { background-color: #e2e8f0 !important; }
                #po-detail-content .border-slate-100 { border-color: #f1f5f9 !important; }
                #po-detail-content .border-slate-200 { border-color: #e2e8f0 !important; }
                #po-detail-content .border-slate-300 { border-color: #cbd5e1 !important; }
                
                /* Amber/Warning colors */
                #po-detail-content .text-amber-800 { color: #92400e !important; }
                #po-detail-content .text-amber-700 { color: #b45309 !important; }
                #po-detail-content .bg-amber-50 { background-color: #fffbeb !important; }
                #po-detail-content .border-amber-500 { border-color: #f59e0b !important; }
                
                /* Emerald/Success colors */
                #po-detail-content .text-emerald-700 { color: #047857 !important; }
                #po-detail-content .text-emerald-600 { color: #059669 !important; }
                #po-detail-content .bg-emerald-50 { background-color: #ecfdf5 !important; }
                
                /* Status Colors */
                #po-detail-content .bg-green-100 { background-color: #dcfce7 !important; }
                #po-detail-content .text-green-700 { color: #15803d !important; }
                #po-detail-content .bg-orange-100 { background-color: #ffedd5 !important; }
                #po-detail-content .text-orange-700 { color: #c2410c !important; }
                #po-detail-content .bg-red-100 { background-color: #fee2e2 !important; }
                #po-detail-content .text-red-700 { color: #b91c1c !important; }
                
                /* Indigo/Primary colors */
                #po-detail-content .text-indigo-700 { color: #4338ca !important; }
                #po-detail-content .bg-indigo-50 { background-color: #eef2ff !important; }
                #po-detail-content .border-indigo-200 { border-color: #c7d2fe !important; }
                
                /* General fixes for any other color variables that might use oklch/oklab */
                #po-detail-content .border-border { border-color: #e2e8f0 !important; }
                #po-detail-content .bg-background { background-color: #ffffff !important; }
                #po-detail-content .text-foreground { color: #0f172a !important; }
                #po-detail-content .text-muted-foreground { color: #64748b !important; }

                .watermark {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%) rotate(-45deg);
                    font-size: 8rem;
                    font-weight: 900;
                    color: rgba(34, 197, 94, 0.1) !important; /* Force compatible color */
                    pointer-events: none;
                    z-index: 0;
                    white-space: nowrap;
                    text-transform: uppercase;
                }
            `}} />

            <div className="space-y-6 pb-20 relative main-layout">
                {/* Actions Header */}
                <div className="flex justify-between items-start no-print">
                    <div className="space-y-1">
                        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setLocation(mode === "approval" ? "/po-approvals" : "/purchase-orders")}>
                            <ChevronLeft className="h-4 w-4 mr-1" /> Back to List
                        </Button>
                        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                            Annexure Detail
                            {getStatusBadge(po.status)}
                        </h1>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => window.print()}>
                            <Printer className="h-4 w-4 mr-2" /> Print PO
                        </Button>

                        <Button
                            variant="outline"
                            className="bg-slate-800 text-white hover:bg-slate-900 border-slate-800"
                            onClick={handleDownloadPdfOpenDialog}
                            disabled={(user?.role === 'purchase_team' && po?.status !== 'approved') || isDownloading || isGeneratingPdf}
                        >
                            {(isDownloading || isGeneratingPdf) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                            {(isDownloading || isGeneratingPdf) ? "Generating..." : "Download PDF"}
                        </Button>

                        {po.status === "draft" && (
                            <Button onClick={() => handleStatusUpdate("pending_approval")} className="bg-blue-600 hover:bg-blue-700 text-white">
                                Submit for Approval
                            </Button>
                        )}

                        {po.status === "pending_approval" && mode === "approval" && (
                            <>
                                <Button variant="outline" className="border-red-600 text-red-600 hover:bg-red-50" onClick={() => { setApprovalAction("reject"); setShowApprovalDialog(true); }}>
                                    Reject
                                </Button>
                                <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => { setApprovalAction("approve"); setShowApprovalDialog(true); }}>
                                    Approve
                                </Button>
                            </>
                        )}

                        {po.status === "approved" && (
                            <Button onClick={() => handleStatusUpdate("ordered")} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold">
                                Confirm Order Sent
                            </Button>
                        )}

                        {po.status === "ordered" && !isReviseMode && (
                            <Button onClick={() => handleStatusUpdate("delivered")} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                                Mark Delivered
                            </Button>
                        )}

                        {po.status !== "revised" && po.status !== "delivered" && po.status !== "rejected" && !isReviseMode && (
                            <Button variant="outline" onClick={handleReviseClick}>
                                <Edit className="h-4 w-4 mr-2" /> Revise PO
                            </Button>
                        )}

                        {isReviseMode && (
                            <>
                                <Button variant="outline" onClick={() => setIsReviseMode(false)}>
                                    <X className="h-4 w-4 mr-2" /> Cancel
                                </Button>
                                <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSaveRevisionClick} disabled={isSubmitting}>
                                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                                    Save Revision
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Revision Notice */}
                {po.status === "revised" && (
                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg flex items-center justify-between no-print">
                        <div className="flex items-center gap-3 text-blue-800">
                            <div className="bg-blue-100 p-2 rounded-full">
                                <Edit className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="font-semibold text-sm">This Annexure has been revised.</p>
                                <p className="text-xs">A newer version of this document exists. Please refer to the related versions below for the latest details.</p>
                            </div>
                        </div>
                        <Button size="sm" variant="outline" className="text-blue-700 border-blue-300 hover:bg-blue-100" onClick={() => {
                            if (relatedPos.length > 0) {
                                // Find the latest one (sorted by created_at DESC in backend)
                                setLocation(`/purchase-orders/${relatedPos[0].id}`);
                            } else {
                                toast({
                                    title: "No other versions found",
                                    description: "We couldn't find a newer version of this PO. It may have been deleted or the numbering has changed.",
                                });
                                const related = document.getElementById('related-versions');
                                related?.scrollIntoView({ behavior: 'smooth' });
                            }
                        }}>
                            View Latest Version
                        </Button>
                    </div>
                )}

                {/* Main PO Document ID Wrapper for PDF */}
                <div id="po-detail-content">
                    {/* Main PO Document Card */}
                    <Card className="max-w-[1000px] mx-auto border-slate-300 shadow-xl overflow-hidden bg-white po-container relative">
                        {po.status === 'approved' && <div className="watermark print-only hidden">Approved</div>}
                        {po.status === 'approved' && <div className="watermark no-print">Approved</div>}

                        <CardContent className="p-8 space-y-8 relative z-10">

                            {/* Header Section - Logo + Company Info + PO Info */}
                            <div className="flex justify-between items-start pb-6 border-b border-slate-200">
                                <div className="flex gap-6">
                                    <img src="/logo.png" alt="Concept Trunk Interiors" className="h-16 w-auto" />
                                    <div className="text-sm leading-tight text-slate-700 space-y-0.5">
                                        <p className="font-bold text-slate-800">Concept Trunk Interiors</p>
                                        <p>12/36A, Indira Nagar, Medavakkam</p>
                                        <p>Chennai, Tamil Nadu 600100</p>
                                        <p className="text-[10px] text-slate-500">GSTIN 33ASOPS5560M1Z1</p>
                                    </div>
                                </div>
                                <div className="text-right space-y-1">
                                    <div className="text-xl font-black text-slate-900 tracking-tighter">ANNEXURE</div>
                                    <div className="text-sm text-slate-500">Annexure No. <span className="font-bold text-slate-800">{po?.po_number}</span></div>

                                    <div className="pt-2 space-y-1">
                                        <div className="flex justify-end gap-3 text-xs">
                                            <span className="text-slate-500 uppercase font-semibold tracking-wider">Date:</span>
                                            <span className="font-bold text-slate-700">{po?.created_at ? new Date(po.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''}</span>
                                        </div>

                                        <div className="flex justify-end gap-3 text-xs">
                                            <span className="text-slate-500 uppercase font-semibold tracking-wider">BOM Version:</span>
                                            <span className="font-bold text-blue-700">{po?.version_number ? `V${po.version_number}` : 'N/A'}</span>
                                        </div>

                                        {isReviseMode ? (
                                            <div className="flex justify-end gap-2 items-center">
                                                <span className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Exp. Delivery <span className="text-red-500">*</span>:</span>
                                                <Input
                                                    type="date"
                                                    className="w-32 h-7 text-xs p-1"
                                                    value={editableDeliveryDate}
                                                    onChange={(e) => setEditableDeliveryDate(e.target.value)}
                                                />
                                            </div>
                                        ) : (
                                            (po?.delivery_date || editableDeliveryDate) && (
                                                <div className="flex justify-end gap-3 text-xs">
                                                    <span className="text-slate-500 uppercase font-semibold tracking-wider">Expected Delivery :</span>
                                                    <span className="font-bold text-slate-700">
                                                        {new Date(editableDeliveryDate || po?.delivery_date || "").toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                    </span>
                                                </div>
                                            )
                                        )}

                                        {po?.dc_number && (
                                            <div className="flex justify-end gap-3 text-xs pt-1">
                                                <span className="text-emerald-600 uppercase font-bold tracking-wider flex items-center gap-1">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                                    </svg>
                                                    DC No:
                                                </span>
                                                <span className="font-black text-emerald-700">{po.dc_number}</span>
                                                {po.dc_date && (
                                                    <span className="text-slate-500 italic">
                                                        ({new Date(po.dc_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })})
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Bill From / Deliver To Grid */}
                            <div className="grid grid-cols-2 gap-12 py-2">
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Bill From</p>

                                        {isReviseMode ? (
                                            <div className="space-y-2 relative z-50">
                                                <select
                                                    className="w-full border border-slate-300 rounded p-1.5 text-sm font-bold text-slate-800 focus:ring-1 focus:ring-primary outline-none bg-white"
                                                    value={editableVendorId}
                                                    onChange={(e) => handleGlobalVendorChange(e.target.value)}
                                                >
                                                    <option disabled value="">Select Vendor</option>
                                                    {shops.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name || "Vendor"}</option>
                                                    ))}
                                                </select>

                                                {/* Display address for selected vendor */}
                                                {shops.find(s => s.id === editableVendorId) && (
                                                    <div className="text-xs text-slate-600 space-y-0.5 pl-1">
                                                        {(() => {
                                                            const s = shops.find(s => s.id === editableVendorId);
                                                            return (
                                                                <>
                                                                    {s.location && <p className="truncate">{s.location}</p>}
                                                                    {s.new_location && <p className="text-xs text-slate-500 italic truncate">Landmark/Loc: {s.new_location}</p>}
                                                                    <p>{[s.city, s.state, s.pincode].filter(Boolean).join(', ')}</p>
                                                                    {s.gstNo && <p className="text-[10px] text-slate-500 mt-1 font-medium">GSTIN: {s.gstNo}</p>}
                                                                </>
                                                            );
                                                        })()}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="text-sm">
                                                <p className="font-bold text-slate-800">{po?.vendor_name || "Vendor"}</p>
                                                {po?.vendor_location && <p className="text-slate-600 truncate">{po.vendor_location}</p>}
                                                {po?.vendor_new_location && <p className="text-xs text-slate-500 italic truncate">Landmark/Loc: {po.vendor_new_location}</p>}
                                                <p className="text-slate-600">
                                                    {[po?.vendor_city, po?.vendor_state, po?.vendor_pincode].filter(Boolean).join(', ')}
                                                </p>
                                                {po?.vendor_gstin && <p className="text-[10px] text-slate-500 mt-1 font-medium">GSTIN: {po.vendor_gstin}</p>}
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-1">
                                        <p className="text-xs text-slate-600">
                                            <span className="font-semibold text-slate-500 uppercase text-[10px] tracking-wider mr-2">Project Name:</span>
                                            <span className="font-bold text-slate-700 uppercase">{po?.project_client || po?.project_name || '—'}</span>
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                        Deliver To {isReviseMode && <span className="text-red-500">*</span>}
                                    </p>
                                    {isReviseMode ? (
                                        <Textarea
                                            placeholder="Enter Shipping Address..."
                                            className="text-xs text-slate-600 min-h-[100px] w-full resize-none p-3 border-slate-200 shadow-sm"
                                            value={shippingAddress}
                                            onChange={(e) => setShippingAddress(e.target.value)}
                                        />
                                    ) : (
                                        <div className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed italic border-l-2 border-slate-100 pl-4 bg-slate-50/30 p-3 rounded-r">
                                            {shippingAddress || "Standard office delivery"}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Approval Comments / Revision Reason */}
                            {po?.approval_comments && (
                                <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-r-md no-print">
                                    <div className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-5 w-5 text-amber-500 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                            </svg>
                                        </div>
                                        <div className="ml-3">
                                            <h3 className="text-sm font-medium text-amber-800">
                                                {po.status === 'rejected' ? 'Rejection Reason' : 'Revision/Approval Note'}
                                            </h3>
                                            <div className="mt-2 text-sm text-amber-700 whitespace-pre-wrap">
                                                {po.approval_comments}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}


                            {/* Items Table Control Bar */}
                            {isReviseMode && (
                                <div className="flex justify-end mb-2 no-print">
                                    <div className="flex items-center gap-2 bg-slate-50 p-2 rounded border border-slate-200">
                                        <span className="text-sm font-medium text-slate-600">Tax Preference (Global):</span>
                                        <select
                                            className="text-sm border border-slate-300 rounded p-1 bg-white outline-none focus:ring-1 focus:ring-primary"
                                            value={taxPreference}
                                            onChange={(e) => setTaxPreference(e.target.value as any)}
                                        >
                                            <option value="exclusive">Tax Exclusive</option>
                                            <option value="inclusive">Tax Inclusive</option>
                                        </select>
                                    </div>
                                </div>
                            )}
                            <div className="border border-slate-300 overflow-hidden">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-slate-100 border-b border-slate-300">
                                            <TableHead className="text-slate-700 font-semibold w-12 text-center text-[10px] py-1">#</TableHead>
                                            <TableHead className="text-slate-700 font-semibold text-[10px] py-1">Item Details</TableHead>
                                            <TableHead className="text-slate-700 font-semibold text-[10px] text-center py-1">Unit</TableHead>
                                            <TableHead className="text-slate-700 font-semibold text-[10px] text-center py-1">HSN</TableHead>
                                            <TableHead className="text-slate-700 font-semibold text-[10px] text-center py-1">SAC</TableHead>
                                            <TableHead className="text-slate-700 font-semibold text-[10px] text-center py-1 bg-slate-200/50">Original Qty</TableHead>
                                            <TableHead className="text-slate-700 font-semibold text-[10px] text-center py-1">Ordered Qty</TableHead>

                                            <TableHead className="text-slate-700 font-semibold text-[10px] text-center py-1">Balance Qty</TableHead>
                                            <TableHead className="text-slate-700 font-semibold text-[10px] text-center py-1">Tax %</TableHead>
                                            <TableHead className="text-slate-700 font-semibold text-[10px] text-right py-1">Rate</TableHead>
                                            <TableHead className="text-slate-700 font-semibold text-[10px] text-right py-1 pr-4">Amount</TableHead>
                                            {isReviseMode && <TableHead className="text-slate-700 font-semibold text-[10px] text-center w-8 py-1 no-print">Action</TableHead>}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {displayItems.map((item, idx) => {
                                            // 1. In REVISE mode: Original is what was in the PO before we started editing (initialItems).
                                            // 2. In VIEW mode for a revision: Original is from the previous PO version (parentItems).
                                            // 3. For Initial PO (R0) View: Original matches Ordered.
                                            let originalQty = parseFloat(item.qty) || 0;

                                            if (isReviseMode) {
                                                // When revising, compare against the items we LOADED from the current PO version
                                                const sourceItem = initialItems.find(o => o.id === item.id);
                                                if (sourceItem) originalQty = parseFloat(sourceItem.qty);
                                            } else if (parentItems.length > 0) {
                                                // When just viewing a revision, match by name from parent version
                                                const originalItem = parentItems.find(o => {
                                                    const oName = (o.item || o.item_name || "").trim();
                                                    const iName = (item.item || item.item_name || "").trim();
                                                    if (!oName || !iName) return false;
                                                    return oName === iName && (o.description || "") === (item.description || "");
                                                });
                                                if (originalItem) originalQty = parseFloat(originalItem.qty);
                                            }

                                            const currentQty = parseFloat(item.qty) || 0;

                                            // Balance Qty = how much of the original requirement is still unordered
                                            const balanceQty = originalQty - currentQty;

                                            return (
                                                <TableRow key={item.id} className="border-b border-slate-200">
                                                    <TableCell className="text-center text-[11px] text-slate-500 py-2">{idx + 1}</TableCell>
                                                    <TableCell className="py-2">
                                                        <div className="flex flex-col gap-1.5">
                                                            {isReviseMode ? (
                                                                <>
                                                                    <div className="text-[11px] font-medium text-slate-800 uppercase px-1">{item.item || item.item_name}</div>
                                                                    <Textarea
                                                                        value={item.description || ""}
                                                                        onChange={(e) => handleDescriptionChange(item.id, e.target.value)}
                                                                        className="min-h-[40px] text-[10px] border-slate-200 mt-1"
                                                                        placeholder="Description"
                                                                    />
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <div className="text-[11px] font-medium text-slate-800 uppercase">{item.item || item.item_name}</div>
                                                                    {item.description && <div className="text-[10px] text-slate-400 mt-0.5 whitespace-pre-wrap">{item.description}</div>}
                                                                </>
                                                            )}
                                                        </div>
                                                        {isReviseMode && itemsAvailability[item.id] === false && (
                                                            <div className="text-[9px] text-red-600 font-bold leading-none mt-1">Unavailable in new shop</div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px] text-slate-600 py-2">{item.unit || "—"}</TableCell>
                                                    <TableCell className="text-center text-[11px] text-slate-600 py-2">{item.hsn_code || "—"}</TableCell>
                                                    <TableCell className="text-center text-[11px] text-slate-600 py-2">{item.sac_code || "—"}</TableCell>

                                                    {/* Original Qty Column */}
                                                    <TableCell className="text-center text-[11px] py-1 bg-slate-50 font-medium text-slate-500">
                                                        {originalQty.toFixed(2)}
                                                    </TableCell>

                                                    {/* Ordered Qty Column */}
                                                    <TableCell className="text-center text-[11px] py-1">
                                                        {isReviseMode ? (
                                                            <Input
                                                                type="number"
                                                                value={item.qty}
                                                                onChange={(e) => handleQtyChange(item.id, e.target.value)}
                                                                className={`w-14 text-center mx-auto h-6 text-[10px] p-0.5 border-2 ${currentQty > originalQty ? 'border-sky-500 bg-sky-50' : currentQty < originalQty ? 'border-orange-500 bg-orange-50' : 'border-slate-200'}`}
                                                                min="0"
                                                                step="0.01"
                                                            />
                                                        ) : (
                                                            currentQty.toFixed(2)
                                                        )}
                                                    </TableCell>

                                                    {/* Balance Qty Column */}
                                                    <TableCell className="text-center text-[11px] py-1">
                                                        <span className={`px-1 py-0.5 rounded-sm font-semibold ${balanceQty === 0 ? 'bg-green-100 text-green-700' : balanceQty < 0 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                                                            {balanceQty.toFixed(2)}
                                                            {balanceQty === 0 && <span className="ml-1 text-[7px] uppercase">(Fulfilled)</span>}
                                                        </span>
                                                    </TableCell>

                                                    {/* Tax Selection Dropdown */}
                                                    <TableCell className="text-center text-[11px] py-1">
                                                        {isReviseMode ? (
                                                            <select
                                                                className="h-6 text-[9px] border rounded w-16 bg-white p-0.5 outline-none focus:ring-1 focus:ring-primary"
                                                                value={item.tax_rate ?? 18}
                                                                onChange={(e) => handleTaxRateChange(item.id, e.target.value)}
                                                            >
                                                                <option value="0">0%</option>
                                                                <option value="5">5%</option>
                                                                <option value="12">12%</option>
                                                                <option value="18">18%</option>
                                                                <option value="28">28%</option>
                                                            </select>
                                                        ) : (
                                                            <Badge variant="outline" className="text-[9px] py-0 px-1 border-slate-200 text-slate-500">
                                                                {item.tax_rate ?? 18}%
                                                            </Badge>
                                                        )}
                                                    </TableCell>

                                                    <TableCell className="text-right text-[11px] py-1">
                                                        {parseFloat(item.rate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                                    </TableCell>

                                                    <TableCell className="text-right text-[11px] font-semibold py-1 pr-4 text-slate-700">
                                                        {parseFloat(item.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                                    </TableCell>



                                                    {isReviseMode && (
                                                        <TableCell className="text-center py-1 no-print">
                                                            <Button variant="ghost" size="sm" onClick={() => handleDeleteItem(item.id)} className="h-5 w-5 p-0 hover:bg-red-50">
                                                                <Trash2 className="h-3 w-3 text-red-500" />
                                                            </Button>
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Totals Section & Terms */}
                            <div className="flex justify-between items-start mt-6">
                                {/* Terms & Conditions */}
                                <div className="flex-1 pr-8 pt-2">
                                    <div className="space-y-4">
                                        <div>
                                            <p className="text-xs text-slate-500 mb-1.5 font-semibold uppercase tracking-wider">
                                                Payment Terms {isReviseMode && <span className="text-red-500">*</span>}
                                            </p>
                                            {isReviseMode ? (
                                                <select
                                                    className="w-full max-w-xs text-sm border border-slate-300 rounded p-2 bg-white outline-none focus:ring-1 focus:ring-primary h-10"
                                                    value={paymentTerms}
                                                    onChange={(e) => setPaymentTerms(e.target.value)}
                                                >
                                                    <option value="">Select Terms</option>
                                                    <option value="Advance">Advance</option>
                                                    <option value="50% Advance">50% Advance</option>
                                                    <option value="Net 15">Net 15</option>
                                                    <option value="Net 30">Net 30</option>
                                                    <option value="Net 45">Net 45</option>
                                                    <option value="On Delivery">On Delivery</option>
                                                    <option value="custom">Other (Enter in Terms)</option>
                                                </select>
                                            ) : (
                                                paymentTerms ? (
                                                    <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 px-3 py-1 font-bold">
                                                        {paymentTerms}
                                                    </Badge>
                                                ) : <span className="text-slate-400 text-xs italic">No payment terms specified.</span>
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-500 mb-1.5 font-semibold uppercase tracking-wider">Additional Terms & Conditions</p>
                                            {isReviseMode ? (
                                                <Textarea
                                                    placeholder="Enter custom terms, banking details, or other conditions..."
                                                    className="text-sm text-slate-600 min-h-[120px] w-full border-slate-300 focus:border-primary"
                                                    value={comment} /* Use comment state as it was mapped to terms in simpler version */
                                                    onChange={(e) => setComment(e.target.value)}
                                                />
                                            ) : (
                                                (po?.comments || po?.approval_comments || po?.vendor_terms) ? (
                                                    <div className="space-y-4">
                                                        {(po.comments || po.approval_comments) && (
                                                            <div className="text-[11px] text-slate-600 whitespace-pre-wrap bg-slate-50/70 p-4 rounded-md border border-slate-100 italic leading-relaxed">
                                                                {po.comments || po.approval_comments}
                                                            </div>
                                                        )}
                                                        {po.vendor_terms && (
                                                            <div className="text-[11px] text-slate-600 whitespace-pre-wrap bg-blue-50/40 p-4 rounded-md border border-blue-100/50 leading-relaxed">
                                                                <p className="font-bold text-blue-800 mb-1 uppercase text-[9px] tracking-wider">Shop Terms & Conditions:</p>
                                                                {po.vendor_terms}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : null
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Totals Engine */}
                                <div className="w-72 space-y-1 bg-white pt-2 shrink-0">
                                    <div className="flex justify-between text-sm py-1">
                                        <span className="text-slate-600 font-medium">Sub Total</span>
                                        <span className="text-slate-800">{displayedSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    {taxPreference === "inclusive" && (
                                        <div className="flex justify-between text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded -mx-2 mb-1">
                                            <span>Subtotal derived from inclusive rate</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-sm py-1">
                                        <span className="text-slate-600">SGST9 (9%)</span>
                                        <span className="text-slate-800">{sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between text-sm py-1">
                                        <span className="text-slate-600">CGST9 (9%)</span>
                                        <span className="text-slate-800">{cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between text-sm py-1">
                                        <span className="text-slate-600">Round off</span>
                                        <span className="text-slate-800">{(grandTotal - totalWithTax).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm font-semibold py-2 border-t border-slate-300">
                                        <span className="text-slate-800">Total</span>
                                        <span className="text-slate-900">₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between text-sm font-semibold py-2 bg-slate-100 px-2 -mx-2">
                                        <span className="text-slate-800">Balance Due</span>
                                        <span className="text-slate-900 font-bold">₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Footer - Authorized Signature */}
                            <div className="pt-12 pb-4">
                                <div className="text-sm text-slate-700">
                                    <span className="font-medium">Authorized Signature</span>
                                    <span className="inline-block w-64 border-b border-slate-400 ml-2"></span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Related PO Versions */}
                {relatedPos.length > 0 && (
                    <Card id="related-versions" className="max-w-[1000px] mx-auto border-blue-200 shadow-lg bg-blue-50/30 no-print mt-6 scroll-mt-20">
                        <CardContent className="p-6">
                            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <Loader2 className="h-5 w-5 text-blue-500" />
                                Related PO Versions
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {relatedPos.map(rpo => (
                                    <div
                                        key={rpo.id}
                                        className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group"
                                        onClick={() => setLocation(`/purchase-orders/${rpo.id}`)}
                                    >
                                        <div>
                                            <div className="font-bold text-slate-800 group-hover:text-blue-600 transition-colors">{rpo.po_number}</div>
                                            <div className="text-[10px] text-slate-500 uppercase tracking-wider">{new Date(rpo.created_at).toLocaleDateString()}</div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            {getStatusBadge(rpo.status)}
                                            <div className="text-[10px] font-bold text-slate-700">₹{parseFloat(rpo.total).toLocaleString()}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}
                      {/* Approval Dialog */}
                <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{approvalAction === "approve" ? "Approve" : "Reject"} Annexure</DialogTitle>
                            <DialogDescription>
                                {approvalAction === "approve"
                                    ? "Are you sure you want to approve this Annexure? This will notify the vendor."
                                    : "Please provide a reason for rejecting this Annexure."}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <Textarea
                                placeholder="Add comments here..."
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                className="min-h-[100px]"
                            />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowApprovalDialog(false)} disabled={isSubmitting}>
                                Cancel
                            </Button>
                            <Button
                                className={approvalAction === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
                                onClick={handleApproval}
                                disabled={isSubmitting}
                            >
                                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {approvalAction === "approve" ? "Confirm Approve" : "Confirm Reject"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* PDF Export Selection Dialog */}
                <Dialog open={isPdfExportDialogOpen} onOpenChange={setIsPdfExportDialogOpen}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-xl">
                                <Download className="h-6 w-6 text-blue-600" />
                                Custom PDF Export
                            </DialogTitle>
                            <DialogDescription className="text-slate-500">
                                Select columns and download the Annexure exactly as it appears on screen.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="py-4 space-y-4">
                            <div className="flex justify-between items-center px-1">
                                <Label className="text-sm font-bold text-slate-700">Columns to Display</Label>
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="h-7 text-[10px] text-blue-600 font-bold"
                                    onClick={() => setSelectedPdfExportCols(["S.No", "Item Details", "Unit", "HSN", "SAC", "Original Qty", "Ordered Qty", "Balance Qty", "Tax %", "Rate", "Amount"])}
                                >
                                    Select All
                                </Button>
                            </div>
                            <ScrollArea className="h-[280px] p-4 border-2 border-slate-100 rounded-xl bg-slate-50/30">
                                <div className="grid grid-cols-1 gap-1">
                                    {["S.No", "Item Details", "Unit", "HSN", "SAC", "Original Qty", "Ordered Qty", "Balance Qty", "Tax %", "Rate", "Amount"].map((col) => (
                                        <div 
                                            key={col} 
                                            className={`flex items-center space-x-3 p-2 rounded-lg transition-colors cursor-pointer ${selectedPdfExportCols.includes(col) ? 'bg-white shadow-sm' : 'hover:bg-slate-100/50'}`}
                                            onClick={() => {
                                                if (selectedPdfExportCols.includes(col)) {
                                                    setSelectedPdfExportCols(prev => prev.filter(c => c !== col));
                                                } else {
                                                    setSelectedPdfExportCols(prev => [...prev, col]);
                                                }
                                            }}
                                        >
                                            <Checkbox
                                                id={`col-${col}`}
                                                checked={selectedPdfExportCols.includes(col)}
                                                className="data-[state=checked]:bg-blue-600 border-2"
                                            />
                                            <Label
                                                htmlFor={`col-${col}`}
                                                className="text-sm font-semibold text-slate-700 cursor-pointer flex-1"
                                            >
                                                {col}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>

                        <DialogFooter className="flex flex-col sm:flex-row gap-2 bg-slate-50 -mx-6 -mb-6 p-4 rounded-b-lg border-t mt-2">
                            <Button variant="outline" className="w-full flex-1" onClick={() => setIsPdfExportDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button 
                                onClick={() => handleDownloadPDF(selectedPdfExportCols)} 
                                disabled={isDownloading || selectedPdfExportCols.length === 0} 
                                className="w-full flex-1 bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-200"
                            >
                                {isDownloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                                Export Selection
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

            {/* Revise Reason Dialog */}
            <Dialog open={showReviseDialog} onOpenChange={setShowReviseDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reason for Quantity Increase</DialogTitle>
                        <DialogDescription>
                            You have increased the quantity of one or more items.
                            This revision will require Admin approval. Please provide a reason.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Textarea
                            placeholder="Enter reason for quantity increase..."
                            value={reviseReason}
                            onChange={(e) => setReviseReason(e.target.value)}
                            className="min-h-[100px]"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowReviseDialog(false)} disabled={isSubmitting}>Cancel</Button>
                        <Button
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => submitRevision(reviseReason)}
                            disabled={isSubmitting || !reviseReason.trim()}
                        >
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Submit Revision
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {/* Delete Existing Revision Dialog */}
            <Dialog open={showDeleteExistingDialog} onOpenChange={setShowDeleteExistingDialog}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-amber-600">
                            Revision Already Exists
                        </DialogTitle>
                        <DialogDescription className="pt-2">
                            A revision (<strong className="text-slate-900">{existingRevisionToDelete?.po_number}</strong>) is currently in <span className="font-semibold uppercase text-slate-700">{existingRevisionToDelete?.status}</span> status.
                            <br /><br />
                            Do you want to <strong>delete</strong> the existing revision and start a fresh one?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-4">
                        <Button variant="outline" onClick={() => setShowDeleteExistingDialog(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={confirmDeleteAndRevise}
                            className="bg-red-600 hover:bg-red-700"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                            Delete & Start Fresh
                        </Button>
                    </DialogFooter>
                </DialogContent>
                </Dialog>
            </div>
        </Layout>
    );
}
