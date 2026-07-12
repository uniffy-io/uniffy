import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import { CaretRight } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";
import type { Domain } from "@/lib/types";
import { DOMAIN_ICON } from "@/components/ReferenceChip";
import * as Ph from "phosphor-react-native";

function getPhosphorIcon(name: string): React.ComponentType<any> {
  const map: Record<string, React.ComponentType<any>> = {
    "edit-2": Ph.PencilSimple,
    "edit-3": Ph.NotePencil,
    "at-sign": Ph.At,
    "share-2": Ph.ShareNetwork,
    star: Ph.Star,
    "map-pin": Ph.MapPin,
    folder: Ph.FolderSimple,
    download: Ph.DownloadSimple,
    "trash-2": Ph.Trash,
    "external-link": Ph.ArrowSquareOut,
    clock: Ph.Clock,
    "plus-circle": Ph.PlusCircle,
    users: Ph.Users,
    archive: Ph.Archive,
    "folder-plus": Ph.FolderPlus,
    camera: Ph.Camera,
    "file-plus": Ph.FilePlus,
    edit: Ph.PencilSimple,
    "user-plus": Ph.UserPlus,
    video: Ph.Video,
    repeat: Ph.ArrowsClockwise,
    "corner-down-right": Ph.ArrowBendDownRight,
    bookmark: Ph.BookmarkSimple,
    copy: Ph.Copy,
    pin: Ph.PushPin,
    zap: Ph.Lightning,
    lock: Ph.Lock,
    key: Ph.Key,
    bell: Ph.Bell,
    grid: Ph.GridFour,
    moon: Ph.Moon,
    "help-circle": Ph.Question,
    "message-square": Ph.ChatText,
    info: Ph.Info,
    "log-out": Ph.SignOut,
    upload: Ph.UploadSimple,
    "link-2": Ph.LinkSimple,
    check: Ph.Check,
    "check-circle": Ph.CheckCircle,
    "arrow-up": Ph.ArrowUp,
    "sort-asc": Ph.SortAscending,
    "sort-desc": Ph.SortDescending,
    "clock-history": Ph.ClockCounterClockwise,
    tag: Ph.Tag,
    "file-text": Ph.FileText,
  };
  return map[name] ?? Ph.DotsThree;
}

export type ActionItem = {
  icon: string;
  label: string;
  sublabel?: string;
  color?: string;
  onPress: () => void;
  isDanger?: boolean;
};

type ActionSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: string | Domain;
  iconColor?: string;
  actions: ActionItem[];
};

export function ActionSheet({
  visible,
  onClose,
  title,
  subtitle,
  icon,
  iconColor,
  actions,
}: ActionSheetProps) {
  const insets = useSafeAreaInsets();
  const T = useTheme();
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const regularActions = actions.filter((a) => !a.isDanger);
  const dangerActions = actions.filter((a) => a.isDanger);

  const domainKeys: Domain[] = ["notes", "files", "chat", "calendar", "projects"];
  const isDomain = icon && domainKeys.includes(icon as Domain);
  const HeaderIcon = isDomain ? DOMAIN_ICON[icon as Domain] : icon ? getPhosphorIcon(icon) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <View />
      </TouchableOpacity>
      <View style={[styles.sheet, { backgroundColor: T.surface, paddingBottom: bottomPad + 8 }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />

        {(title || icon) && (
          <View style={[styles.header, { borderBottomColor: T.border }]}>
            {HeaderIcon && iconColor && (
              <View style={[styles.headerIcon, { backgroundColor: iconColor + "20" }]}>
                <HeaderIcon size={18} color={iconColor} weight="bold" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: T.textBright }]}>{title}</Text>
              {subtitle && (
                <Text style={[styles.headerSubtitle, { color: T.textDim }]}>{subtitle}</Text>
              )}
            </View>
          </View>
        )}

        <ScrollView bounces={false}>
          {regularActions.map((action, i) => {
            const ActionIcon = getPhosphorIcon(action.icon);
            return (
              <TouchableOpacity
                key={i}
                style={[styles.actionRow, { borderBottomColor: T.border }]}
                onPress={() => {
                  action.onPress();
                  onClose();
                }}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.actionIcon,
                    { backgroundColor: (action.color ?? T.textDim) + "18" },
                  ]}
                >
                  <ActionIcon size={16} color={action.color ?? T.text} weight="duotone" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionLabel, { color: action.color ?? T.textBright }]}>
                    {action.label}
                  </Text>
                  {action.sublabel && (
                    <Text style={[styles.actionSub, { color: T.textDim }]}>{action.sublabel}</Text>
                  )}
                </View>
                <CaretRight size={14} color={T.textDim} weight="bold" />
              </TouchableOpacity>
            );
          })}

          {dangerActions.map((action, i) => {
            const ActionIcon = getPhosphorIcon(action.icon);
            return (
              <TouchableOpacity
                key={`danger-${i}`}
                style={[styles.actionRow, { borderBottomColor: T.border }]}
                onPress={() => {
                  action.onPress();
                  onClose();
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.actionIcon, { backgroundColor: "#FA525218" }]}>
                  <ActionIcon size={16} color="#FA5252" weight="duotone" />
                </View>
                <Text style={[styles.actionLabel, { color: "#FA5252", flex: 1 }]}>
                  {action.label}
                </Text>
                <CaretRight size={14} color="#FA525270" weight="bold" />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 15,
    fontFamily: FONT.semibold,
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: FONT.regular,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    fontSize: 15,
    fontFamily: FONT.medium,
  },
  actionSub: {
    fontSize: 12,
    fontFamily: FONT.regular,
    marginTop: 1,
  },
});
