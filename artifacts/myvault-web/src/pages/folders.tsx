import { useState } from "react";
import { useLocation } from "wouter";
import { useListFolders, useCreateFolder, getListFoldersQueryKey } from "@workspace/api-client-react";
import type { Folder } from "@workspace/api-client-react";
import { useWorkspace } from "@/lib/providers";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { FolderOpen, FolderClosed, ChevronRight, Plus, FileText } from "lucide-react";

function buildTree(folders: Folder[]): (Folder & { children: Folder[] })[] {
  const map = new Map<string, Folder & { children: Folder[] }>();
  const roots: (Folder & { children: Folder[] })[] = [];
  for (const f of folders) map.set(f.id, { ...f, children: [] });
  for (const f of map.values()) {
    if (f.parentId) map.get(f.parentId)?.children.push(f);
    else roots.push(f);
  }
  return roots.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
}

function FolderNode({ folder, depth = 0 }: { folder: Folder & { children: Folder[] }; depth?: number }) {
  const [open, setOpen] = useState(depth === 0);
  const [, navigate] = useLocation();
  const hasChildren = folder.children.length > 0;

  return (
    <div>
      <div
        data-testid={`folder-node-${folder.id}`}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-muted transition-all group",
          depth > 0 && "ml-4"
        )}
        onClick={() => navigate(`/folders/${folder.id}`)}
      >
        {hasChildren ? (
          <button
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
            data-testid={`folder-toggle-${folder.id}`}
          >
            <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {open && hasChildren
          ? <FolderOpen className="w-4 h-4 text-primary shrink-0" />
          : <FolderClosed className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
        }
        <span className="flex-1 text-sm font-medium text-foreground truncate">{folder.title}</span>
        <span className="text-xs text-muted-foreground shrink-0">{folder.noteCount}</span>
      </div>
      {open && hasChildren && (
        <div>
          {folder.children.map(child => (
            <FolderNode key={child.id} folder={child as Folder & { children: Folder[] }} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FoldersPage() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const { data: folders = [], isLoading } = useListFolders({ workspace });
  const tree = buildTree(folders);

  const createFolder = useCreateFolder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey({ workspace }) });
        setShowNew(false);
        setNewTitle("");
      },
    },
  });

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Folders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{folders.length} folders</p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)} data-testid="new-folder-btn">
          <Plus className="w-4 h-4 mr-1.5" /> New Folder
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : tree.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No folders yet</p>
          <p className="text-xs mt-1">Create a folder to organise your notes</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {tree.map(folder => (
            <FolderNode key={folder.id} folder={folder} />
          ))}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="folder-title">Name</Label>
              <Input
                id="folder-title"
                data-testid="input-folder-title"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Folder name"
                onKeyDown={e => { if (e.key === "Enter" && newTitle.trim()) createFolder.mutate({ data: { title: newTitle.trim(), workspace } }); }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button
                data-testid="button-create-folder"
                disabled={!newTitle.trim() || createFolder.isPending}
                onClick={() => createFolder.mutate({ data: { title: newTitle.trim(), workspace } })}
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
