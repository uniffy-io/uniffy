module github.com/uniffy-io/unictl

go 1.26.0

require github.com/uniffy-io/uniffy-proto-go v0.0.0

require (
	connectrpc.com/connect v1.21.0 // indirect
	golang.org/x/net v0.57.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.40.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260706201446-f0a921348800 // indirect
	google.golang.org/grpc v1.84.0 // indirect
	google.golang.org/protobuf v1.36.12 // indirect
)

replace github.com/uniffy-io/uniffy-proto-go => ../proto/gen/go
