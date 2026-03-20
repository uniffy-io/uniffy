package main

import (
	"fmt"
	"os"

	commonv1 "github.com/uniffy-io/uniffy-proto-go/common/v1"
	authv1connect "github.com/uniffy-io/uniffy-proto-go/auth/v1/authv1connect"
	notesv1connect "github.com/uniffy-io/uniffy-proto-go/notes/v1/notesv1connect"
)

func main() {
	// Verify generated proto imports are accessible.
	fmt.Println("unictl - Uniffy CLI")
	fmt.Println()

	// Test common types are importable.
	fmt.Printf("ContentType NOTE = %d\n", commonv1.ContentType_CONTENT_TYPE_NOTE)

	// Test service names resolve from connect definitions.
	fmt.Printf("AuthService:  %s\n", authv1connect.AuthServiceName)
	fmt.Printf("NotesService: %s\n", notesv1connect.NotesServiceName)

	if len(os.Args) > 1 && os.Args[1] == "version" {
		fmt.Println("unictl v0.1.0-dev")
	}
}
