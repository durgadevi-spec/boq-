import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout/Layout";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
    CheckCircle2,
    XCircle,
    Loader2,
    Eye,
    Building2,
    Truck,
    Clock,
    User,
} from "lucide-react";
import apiFetch from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ApprovalItem {
    id: string;
    type: 'Annexure' | 'Request';
    po_number: string;
    project_name: string;
    vendor_name: string;
    total_amount: string;
    created_at: string;
    status: string;
}

export default function POApprovals() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [showApprovalDialog, setShowApprovalDialog] = useState(false);
    const [selectedItem, setSelectedItem] = useState<ApprovalItem | null>(null);
    const [approvalAction, setApprovalAction] = useState<"approve" | "reject">("approve");
    const [comment, setComment] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [statusFilter, setStatusFilter] = useState<string>("pending_approval");

    useEffect(() => {
        fetchApprovals();
    }, []);

    const fetchApprovals = async () => {
        try {
            setLoading(true);
            const [poData, reqData] = await Promise.all([
                apiFetch("/api/purchase-orders?status=pending_approval").then(r => r.ok ? r.json() : { purchaseOrders: [] }),
                apiFetch("/api/po-requests?status=pending_approval").then(r => r.ok ? r.json() : { poRequests: [] })
            ]);

            const mappedPos = (poData.purchaseOrders || []).map((po: any) => ({
                id: po.id,
                type: 'Annexure',
                po_number: po.po_number,
                project_name: po.project_name || "N/A",
                vendor_name: po.vendor_name || "N/A",
                total_amount: po.total_amount,
                created_at: po.created_at,
                status: po.status
            }));

            const mappedReqs = (reqData.poRequests || []).map((req: any) => ({
                id: req.id,
                type: 'Request',
                po_number: `Anx-${req.id.slice(0, 4).toUpperCase()}-${req.id.slice(4, 8).toUpperCase()}`,
                project_name: req.project_name || "N/A",
                vendor_name: req.requester_name || "N/A",
                total_amount: "0.00",
                created_at: req.created_at,
                status: req.status
            }));

            const combined = [...mappedPos, ...mappedReqs].sort((a, b) => 
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

            setApprovals(combined);
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to load pending approvals.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleApproval = async () => {
        if (!selectedItem) return;
        setIsSubmitting(true);
        try {
            const isRequest = selectedItem.type === 'Request';
            const endpoint = isRequest 
                ? `/api/po-requests/${selectedItem.id}/status`
                : `/api/purchase-orders/${selectedItem.id}/approve`;
            
            const method = isRequest ? "PATCH" : "POST";
            const body = isRequest 
                ? { status: approvalAction === "approve" ? "approved" : "rejected" }
                : { approve: approvalAction === "approve", comment };

            const res = await apiFetch(endpoint, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (res.ok) {
                toast({
                    title: approvalAction === "approve" ? "Approved" : "Rejected",
                    description: `${selectedItem.type} ${selectedItem.po_number} has been ${approvalAction === "approve" ? "approved" : "rejected"}.`,
                });
                setShowApprovalDialog(false);
                setComment("");
                fetchApprovals();
            }
        } catch (error) {
            toast({ title: "Error", description: "Failed to process approval", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const filteredApprovals = approvals.filter(item => {
        if (statusFilter === "pending_approval") return item.status === "pending_approval" || item.status === "pending";
        if (statusFilter === "approved") return item.status === "approved";
        if (statusFilter === "rejected") return item.status === "rejected";
        return true;
    });

    if (loading) {
        return (
            <Layout>
                <div className="flex flex-col items-center justify-center min-h-[60vh]">
                    <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                    <p className="text-muted-foreground">Loading pending approvals...</p>
                </div>
            </Layout>
        );
    }

    return (
        <Layout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Annexure Approvals</h1>
                    <p className="text-muted-foreground">Review and act on Annexures awaiting approval.</p>
                </div>
                <div className="flex items-center gap-4 mb-2">
                    <span className="font-medium">Filter:</span>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="pending_approval">Pending</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="bg-slate-50/50 border-b">
                        <CardTitle className="text-lg font-semibold">
                            {statusFilter === "pending_approval" && `Pending Requests (${filteredApprovals.length})`}
                            {statusFilter === "approved" && `Approved Requests (${filteredApprovals.length})`}
                            {statusFilter === "rejected" && `Rejected Requests (${filteredApprovals.length})`}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="font-bold">Annexure No.</TableHead>
                                    <TableHead className="font-bold">Project</TableHead>
                                    <TableHead className="font-bold">Vendor</TableHead>
                                    <TableHead className="font-bold text-right">Amount</TableHead>
                                    <TableHead className="font-bold">Date</TableHead>
                                    <TableHead className="text-right font-bold w-[280px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredApprovals.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground italic">
                                            {statusFilter === "pending_approval" && "No pending Annexure approvals."}
                                            {statusFilter === "approved" && "No approved Annexure approvals."}
                                            {statusFilter === "rejected" && "No rejected Annexure approvals."}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredApprovals.map((item) => (
                                        <TableRow key={item.id} className="hover:bg-slate-50/50">
                                            <TableCell className="font-bold text-primary">
                                                {item.po_number}
                                                {item.type === 'Request' && (
                                                    <Badge variant="secondary" className="ml-2 bg-orange-50 text-orange-600 border-orange-200 text-[10px] h-4 px-1">REQ</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <Building2 className="h-4 w-4 text-slate-400" />
                                                    <span className="font-medium">{item.project_name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    {item.type === 'Annexure' ? (
                                                        <Truck className="h-4 w-4 text-slate-400" />
                                                    ) : (
                                                        <User className="h-4 w-4 text-slate-400" />
                                                    )}
                                                    <span>{item.vendor_name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-bold text-green-700">
                                                {item.type === 'Annexure' ? (
                                                    `₹${parseFloat(item.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                                                ) : (
                                                    <span className="text-slate-400 italic font-normal text-xs">Pending</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                <div className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {new Date(item.created_at).toLocaleDateString()}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="outline" size="sm" onClick={() => setLocation(item.type === 'Annexure' ? `/purchase-orders/${item.id}?mode=approval` : `/po-requests/${item.id}?mode=approval`)}>
                                                        <Eye className="h-4 w-4 mr-1" /> View
                                                    </Button>
                                                    <Button variant="outline" size="sm" className="border-red-600 text-red-600 hover:bg-red-50" onClick={() => { setSelectedItem(item); setApprovalAction("reject"); setShowApprovalDialog(true); }}>
                                                        <XCircle className="h-4 w-4 mr-1" /> Reject
                                                    </Button>
                                                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => { setSelectedItem(item); setApprovalAction("approve"); setShowApprovalDialog(true); }}>
                                                        <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {/* Approval Dialog */}
            <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{approvalAction === "approve" ? "Approve" : "Reject"} {selectedItem?.type === 'Annexure' ? 'Annexure' : 'Request'}</DialogTitle>
                        <DialogDescription>
                            {approvalAction === "approve"
                                ? `Confirming approval for ${selectedItem?.type === 'Annexure' ? 'Annexure' : 'Request'} No. ${selectedItem?.po_number}.`
                                : `Please provide a reason for rejecting ${selectedItem?.type === 'Annexure' ? 'Annexure' : 'Request'} No. ${selectedItem?.po_number}.`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Textarea
                            placeholder="Enter your comments here..."
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            className="min-h-[100px]"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowApprovalDialog(false)} disabled={isSubmitting}>Cancel</Button>
                        <Button
                            className={approvalAction === "approve" ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}
                            onClick={handleApproval}
                            disabled={isSubmitting || (approvalAction === "reject" && !comment.trim())}
                        >
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {approvalAction === "approve" ? "Approve" : "Reject"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Layout>
    );
}
