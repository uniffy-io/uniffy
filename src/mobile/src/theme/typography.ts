// Font family tokens. The app ships Poppins (closest open-source match to
// the brand book's Gilroy); when licensed Gilroy files land, swapping the
// brand typeface is a change to this file plus the font loader in
// app/_layout.tsx.
export const FONT = {
  light: "Poppins_300Light",
  regular: "Poppins_400Regular",
  medium: "Poppins_500Medium",
  semibold: "Poppins_600SemiBold",
  bold: "Poppins_700Bold",
} as const;
