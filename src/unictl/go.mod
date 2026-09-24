module github.com/uniffy-io/unictl

go 1.26.0

require github.com/uniffy-io/uniffy-proto-go v0.0.0

require (
	connectrpc.com/connect v1.18.1 // indirect
	golang.org/x/net v0.48.0 // indirect
	golang.org/x/sys v0.39.0 // indirect
	golang.org/x/text v0.32.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251202230838-ff82c1b0f217 // indirect
	google.golang.org/grpc v1.79.3 // indirect
	google.golang.org/protobuf v1.36.10 // indirect
)

replace github.com/uniffy-io/uniffy-proto-go => ../proto/gen/go
