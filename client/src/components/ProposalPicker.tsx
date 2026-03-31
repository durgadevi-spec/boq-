import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PlusCircle, CheckCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import apiFetch from "@/lib/api";
import { Badge } from "@/components/ui/badge";

interface ProposalPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onSelectProposal: (proposalItems: any[]) => void;
}

export default function ProposalPicker({ open, onOpenChange, projectId, onSelectProposal }: ProposalPickerProps) {
  const { data: proposals, isLoading } = useQuery({
    queryKey: ["/api/proposals/approved", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const res = await apiFetch(`/api/proposals/approved/${projectId}`);
      if (!res.ok) throw new Error("Failed to load approved proposals");
      return res.json();
    },
    enabled: !!open && !!projectId,
  });

  const handleApply = async (proposalId: string) => {
    try {
      const res = await apiFetch(`/api/proposals/${proposalId}/items`);
      if (res.ok) {
        const items = await res.json();
        onSelectProposal(items);
        onOpenChange(false);
      }
    } catch (err) {
      console.error("Failed to fetch proposal items", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add Approved Proposal to BOM</DialogTitle>
        </DialogHeader>

        <div className="border rounded-md mt-4">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Date Approved</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : proposals?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No approved proposals found for this project.
                  </TableCell>
                </TableRow>
              ) : (
                proposals?.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-semibold">{p.vendor_name || "Unknown Vendor"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">v{p.version_number}</Badge>
                    </TableCell>
                    <TableCell>{new Date(p.updated_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => handleApply(p.id)} className="bg-blue-600 hover:bg-blue-700">
                        <PlusCircle className="h-4 w-4 mr-1.5" /> Append to BOM
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
