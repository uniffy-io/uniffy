import { useState, useEffect, useCallback, useMemo } from "react";
import { Hash, MagnifyingGlass, Users, SignIn } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { selectChannels } from "@/features/chat/store/chatChannelsSlice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { closeBrowseChannelsModal } from "@/features/chat/store/chatUiSlice";
import { fetchPublicChannels, joinChannel } from "@/features/chat/store/chatThunks";
import type { ChatChannel } from "@/features/chat/types";

export function BrowseChannelsModal() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const myChannels = useAppSelector(selectChannels);

  const [publicChannels, setPublicChannels] = useState<ChatChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    dispatch(fetchPublicChannels())
      .unwrap()
      .then((channels) => {
        if (!cancelled) setPublicChannels(channels);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const handleClose = useCallback(() => {
    dispatch(closeBrowseChannelsModal());
  }, [dispatch]);

  const myChannelIds = useMemo(() => new Set(myChannels.map((c) => c.id)), [myChannels]);

  const filteredChannels = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return publicChannels.filter(
      (c) =>
        !query ||
        c.name.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query),
    );
  }, [publicChannels, searchQuery]);

  const handleJoin = useCallback(
    async (channelId: string) => {
      setJoiningId(channelId);
      try {
        await dispatch(joinChannel(channelId)).unwrap();
        navigate(`/chat/${channelId}`);
        handleClose();
      } finally {
        setJoiningId(null);
      }
    },
    // The deps below ARE read in the body; oxlint's memo analysis misses reads
    // inside try/finally blocks and object-literal call arguments.
    // eslint-disable-next-line react/react-compiler
    [dispatch, navigate, handleClose],
  );

  const handleOpen = useCallback(
    (channelId: string) => {
      navigate(`/chat/${channelId}`);
      handleClose();
    },
    [navigate, handleClose],
  );

  return (
    <Modal onClose={handleClose} className="flex flex-col max-h-[85dvh]">
      <div data-testid="chat-browse-channels-modal" className="flex flex-col min-h-0">
        <ModalHeader
          title="Browse channels"
          onClose={handleClose}
          closeTestId="chat-browse-channels-close"
        />

        <div className="px-6 py-3 border-b border-border shrink-0">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="text"
              placeholder="Search channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
              data-testid="chat-browse-channels-search"
            />
          </div>
        </div>

        <ModalBody scrollable={false} className="flex-1 min-h-0 overflow-y-auto p-0 space-y-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading channels...
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground">
                <Hash size={32} className="mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-sm">
                  {searchQuery ? "No channels match your search." : "No public channels yet."}
                </p>
              </div>
            </div>
          ) : (
            filteredChannels.map((channel) => {
              const isMember = myChannelIds.has(channel.id);
              return (
                <div
                  key={channel.id}
                  className="flex items-start gap-3 px-6 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors"
                  data-testid={`chat-browse-channels-row-${channel.id}`}
                  data-member={isMember ? "true" : "false"}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Hash size={14} className="text-muted-foreground shrink-0" />
                      <span className="text-sm font-semibold text-foreground truncate">
                        {channel.name}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <Users size={12} />
                        {channel.memberCount}
                      </span>
                    </div>
                    {channel.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 ml-5">
                        {channel.description}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 mt-0.5">
                    {isMember ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpen(channel.id)}
                        data-testid={`chat-browse-channels-open-${channel.id}`}
                      >
                        Open
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleJoin(channel.id)}
                        loading={joiningId === channel.id}
                        disabled={joiningId !== null}
                        data-testid={`chat-browse-channels-join-${channel.id}`}
                      >
                        <SignIn size={14} />
                        Join
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </ModalBody>
      </div>
    </Modal>
  );
}
